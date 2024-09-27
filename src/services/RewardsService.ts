import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { APIBlock } from '../database/models/Block.js';
import logger from '../utils/logger.js';

export class RewardsService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {}

  /* async calculateStakeRewards(validatorAddress: string, blockReward: bigint): Promise<bigint> {
    try {
      const totalNetworkStake = await this.aleoSDKService.getTotalNetworkStake();
      const committeeData = await this.aleoSDKService.getCommitteeMapping(validatorAddress);
      
      if (!committeeData || !committeeData.isOpen) {
        return BigInt(0); // Validator komitede değilse veya aktif değilse ödül yok
      }

      const bondedData = await this.aleoSDKService.getBondedMapping(validatorAddress);
      const validatorStake = bondedData ? bondedData.microcredits : BigInt(0);
      const delegatedAmount = await this.aleoSDKService.getDelegatedMapping(validatorAddress);

      const totalValidatorStake = validatorStake + delegatedAmount;

      // Validator'ın stake'inin ağ üzerindeki toplam stake'in 1/4'ünden fazla olup olmadığını kontrol et
      const maxAllowedStake = totalNetworkStake / BigInt(4);
      const effectiveStake = totalValidatorStake > maxAllowedStake ? maxAllowedStake : totalValidatorStake;

      // Minimum gereksinimi kontrol et (10 Milyon)
      const minimumStake = BigInt(10_000_000) * BigInt(1e9); // 10 milyon ALEO
      if (effectiveStake < minimumStake) {
        return BigInt(0);
      }

      const reward = (blockReward * effectiveStake) / totalNetworkStake;

      // Komisyon hesaplaması
      const validatorReward = (reward * BigInt(committeeData.commission)) / BigInt(100);
      const delegatorReward = reward - validatorReward;

      return validatorReward;
    } catch (error) {
      logger.error(`Error calculating stake rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  } */

  async calculateStakeRewards(block: APIBlock): Promise<void> {
    try {
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

      for (const [address, [stake, isOpen, commission]] of Object.entries(committee.members)) {
        const memberStake = BigInt(stake);
        const memberReward = (memberStake * BigInt(blockReward)) / totalStake;
        
        const commissionRate = BigInt(commission) / BigInt(100);
        const commissionAmount = (memberReward * commissionRate) / BigInt(100);
        const finalReward = memberReward - commissionAmount;

        await this.snarkOSDBService.updateValidatorRewards(address, finalReward, blockHeight);
        
        if (isOpen) {
          await this.distributeDelegatorRewards(address, commissionAmount, blockHeight);
        }
      }

      // Block ödülünü blocks tablosuna kaydet
      await this.snarkOSDBService.upsertBlock({
        ...this.aleoSDKService.convertToBlockAttributes(block),
        block_reward: Number(blockReward)
      });

    } catch (error) {
      logger.error(`Error calculating stake rewards for block ${block.block_hash}:`, error);
      throw error;
    }
  }

  private getBlockReward(block: APIBlock): number | null {
    const blockReward = block.ratifications.find(r => r.type === 'block_reward');
    return blockReward ? Number(blockReward.amount) : null;
  }

  private calculateTotalStake(members: Record<string, [number, boolean, number]>): bigint {
    return Object.values(members).reduce((sum, [stake]) => sum + BigInt(stake), BigInt(0));
  }

  private async distributeDelegatorRewards(validatorAddress: string, rewardAmount: bigint, blockHeight: bigint): Promise<void> {
    try {
      const delegators = await this.snarkOSDBService.getDelegators(validatorAddress);
      const totalDelegatedStake = delegators.reduce((sum, d) => sum + d.amount, BigInt(0));

      for (const delegator of delegators) {
        const delegatorReward = (delegator.amount * rewardAmount) / totalDelegatedStake;
        await this.snarkOSDBService.updateDelegatorRewards(delegator.address, delegatorReward, blockHeight);
      }
    } catch (error) {
      logger.error(`Error distributing delegator rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorRewards(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.snarkOSDBService.getValidatorRewardsInRange(validatorAddress, startBlock, endBlock);
  }

  async getDelegatorRewards(delegatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.snarkOSDBService.getDelegatorRewardsInRange(delegatorAddress, startBlock, endBlock);
  }
}

export default RewardsService;
