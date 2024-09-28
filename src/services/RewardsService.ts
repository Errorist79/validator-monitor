import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { APIBlock } from '../database/models/Block.js';
import logger from '../utils/logger.js';

export class RewardsService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {}

  async calculateAndDistributeRewards(): Promise<void> {
    try {
      const latestBlock = await this.aleoSDKService.getLatestBlock();
      if (!latestBlock) {
        logger.warn('No latest block found for reward calculation');
        return;
      }

      const apiBlock = await this.aleoSDKService.getBlock(latestBlock.height);
      if (!apiBlock) {
        logger.warn(`Failed to get API block for height ${latestBlock.height}`);
        return;
      }

      await this.calculateStakeRewards(apiBlock);
      logger.info(`Rewards calculated and distributed for block ${apiBlock.header.metadata.height}`);
    } catch (error) {
      logger.error('Error in calculateAndDistributeRewards:', error);
      throw error;
    }
  }

  async calculateStakeRewards(block: APIBlock): Promise<void> {
    try {
      logger.debug(`Calculating stake rewards for block ${block.header.metadata.height}`);
      
      const blockReward = this.getBlockReward(block);
      if (blockReward === null) {
        logger.warn(`No block reward found for block ${block.block_hash}`);
        return;
      }

      const committee = await this.aleoSDKService.getLatestCommittee();
      if (!committee || !committee.members) {
        logger.warn(`No committee information found for block ${block.block_hash}`);
        return;
      }

      const blockHeight = BigInt(block.header.metadata.height);
      const totalStake = this.calculateTotalStake(committee.members);

      logger.debug(`Total stake: ${totalStake}, Block reward: ${blockReward}`);

      for (const [address, [stake, isOpen, commission]] of Object.entries(committee.members)) {
        const memberStake = BigInt(stake);
        const memberReward = (memberStake * BigInt(blockReward)) / totalStake;
        
        const commissionRate = BigInt(commission) / BigInt(100);
        const commissionAmount = (memberReward * commissionRate) / BigInt(100);
        const finalReward = memberReward - commissionAmount;

        logger.debug(`Validator ${address}: Stake: ${memberStake}, Reward: ${finalReward}`);

        await this.snarkOSDBService.updateValidatorRewards(address, finalReward, blockHeight);
        
        if (isOpen) {
          await this.distributeDelegatorRewards(address, commissionAmount, blockHeight);
        }
      }

      await this.snarkOSDBService.updateBlockReward(block.block_hash, BigInt(blockReward));
      logger.info(`Rewards calculated and distributed for block ${block.header.metadata.height}`);
    } catch (error) {
      logger.error(`Error calculating stake rewards for block ${block.header.metadata.height}:`, error);
      throw error;
    }
  }

  private getBlockReward(block: APIBlock): number | null {
    const blockReward = block.ratifications.find(r => r.type === 'BlockReward');
    return blockReward && blockReward.data ? Number(blockReward.data) : null;
  }

  private calculateTotalStake(members: Record<string, [number, boolean, number]>): bigint {
    return Object.values(members).reduce((sum, [stake]) => sum + BigInt(stake), BigInt(0));
  }

  private async distributeDelegatorRewards(validatorAddress: string, rewardAmount: bigint, blockHeight: bigint): Promise<void> {
    try {
      const delegators = await this.snarkOSDBService.getDelegators(validatorAddress);
      const totalDelegatedStake = delegators.reduce((sum, d) => sum + d.amount, BigInt(0));

      logger.debug(`Distributing rewards for validator ${validatorAddress}: Total delegated stake: ${totalDelegatedStake}, Reward amount: ${rewardAmount}`);

      for (const delegator of delegators) {
        const delegatorReward = (delegator.amount * rewardAmount) / totalDelegatedStake;
        await this.snarkOSDBService.updateDelegatorRewards(delegator.address, delegatorReward, blockHeight);
        logger.debug(`Delegator ${delegator.address} received reward: ${delegatorReward}`);
      }
    } catch (error) {
      logger.error(`Error distributing delegator rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorRewards(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.snarkOSDBService.getValidatorRewardsInRange(validatorAddress, startBlock, endBlock);
  }
}

export default RewardsService;
