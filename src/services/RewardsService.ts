import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { APIBlock } from '../database/models/Block.js';
import logger from '../utils/logger.js';
import { CronJob } from 'cron';

interface ValidatorReward {
  address: string;
  timestamp: number;
  amount: bigint;
}

export class RewardsService {
  private rewardsHistory: Map<string, ValidatorReward[]> = new Map();

  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {
    // Her 15 dakikada bir ödülleri hesapla ve dağıt
    new CronJob('*/15 * * * *', this.calculateAndDistributeRewards.bind(this), null, true);
  }

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
        const totalValidatorStake = await this.snarkOSDBService.getTotalValidatorStake(address);

        if (totalValidatorStake < BigInt(10_000_000)) {
          logger.warn(`Validator ${address} has less than 10 million credits. Skipping reward calculation.`);
          continue;
        }

        const baseReward = (memberStake * BigInt(blockReward)) / totalStake;
        const delegatedStake = totalValidatorStake - memberStake;
        const commissionRate = BigInt(commission);
        const commissionAmount = (delegatedStake * baseReward * commissionRate) / (totalValidatorStake * BigInt(100));
        const validatorReward = ((memberStake * baseReward) / totalValidatorStake) + commissionAmount;
        const delegatorReward = baseReward - validatorReward;

        logger.debug(`Validator ${address}: Stake: ${memberStake}, Reward: ${validatorReward}`);

        await this.updateRewardHistory(address, validatorReward, block.header.metadata.timestamp);
        await this.snarkOSDBService.updateValidatorRewards(address, validatorReward, blockHeight);
        
        if (isOpen) {
          await this.distributeDelegatorRewards(address, delegatorReward, blockHeight);
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
    const blockReward = block.ratifications.find(r => r.type === 'block_reward');
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

  private async updateRewardHistory(address: string, reward: bigint, timestamp: number): Promise<void> {
    if (!this.rewardsHistory.has(address)) {
      this.rewardsHistory.set(address, []);
    }
    this.rewardsHistory.get(address)!.push({ address, timestamp, amount: reward });
    await this.snarkOSDBService.insertValidatorRewardHistory(address, reward, timestamp);
  }

  async getValidatorRewards(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.snarkOSDBService.getValidatorRewardsInRange(validatorAddress, startBlock, endBlock);
  }

  async getValidatorPerformanceMetrics(validatorAddress: string, startTime: number, endTime: number): Promise<{
    totalRewards: bigint;
    averageReward: bigint;
    rewardFrequency: number;
  }> {
    const rewards = await this.snarkOSDBService.getValidatorRewardsInTimeRange(validatorAddress, startTime, endTime);
    const totalRewards = rewards.reduce((sum: bigint, reward: { amount: bigint }) => sum + reward.amount, BigInt(0));
    const averageReward = rewards.length > 0 ? totalRewards / BigInt(rewards.length) : BigInt(0);
    const timeInterval = (endTime - startTime) / (60 * 60 * 24); // Gün cinsinden zaman aralığı
    const rewardFrequency = rewards.length / timeInterval;

    return { totalRewards, averageReward, rewardFrequency };
  }

  async generateValidatorPerformanceReport(validatorAddress: string, startTime: number, endTime: number): Promise<{
    address: string;
    totalStake: bigint;
    commissionRate: number;
    totalReward: bigint;
    averageDailyReward: bigint;
    rewardFrequency: number;
  }> {
    const [validatorInfo, metrics] = await Promise.all([
      this.snarkOSDBService.getValidatorInfo(validatorAddress),
      this.getValidatorPerformanceMetrics(validatorAddress, startTime, endTime)
    ]);

    const days = (endTime - startTime) / (60 * 60 * 24);
    const averageDailyReward = metrics.totalRewards / BigInt(days);

    return {
      address: validatorAddress,
      totalStake: validatorInfo.totalStake,
      commissionRate: validatorInfo.commissionRate,
      totalReward: metrics.totalRewards,
      averageDailyReward,
      rewardFrequency: metrics.rewardFrequency
    };
  }
}

export default RewardsService;
