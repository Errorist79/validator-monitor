import { SnarkOSDBService } from './SnarkOSDBService.js';
import { RewardsDBService } from './database/RewardsDBService.js';
import logger from '../utils/logger.js';

export class RewardsService {
  constructor(
    private snarkOSDBService: SnarkOSDBService,
    private rewardsDBService: RewardsDBService
  ) {}

  async calculateAndDistributeRewards(latestBlockHeight: number): Promise<void> {
    try {
      const lastProcessedBlock = await this.rewardsDBService.getLatestProcessedBlockHeight();
      logger.debug(`Last processed block: ${lastProcessedBlock}`);
      
      const earliestBlockHeight = await this.snarkOSDBService.getEarliestBlockHeight();
      const lastProcessedBlockNumber = lastProcessedBlock ? Number(lastProcessedBlock) : null;
      const earliestBlockHeightNumber = Number(earliestBlockHeight);

      const startBlock = Math.max(
        lastProcessedBlockNumber !== null ? lastProcessedBlockNumber + 1 : earliestBlockHeightNumber,
        earliestBlockHeightNumber
      );
      logger.info(`Calculating rewards from block ${startBlock} to ${latestBlockHeight}`);

      const BATCH_SIZE = 50; // Her seferinde 50 blok işle
      for (let batchStart = startBlock; batchStart <= latestBlockHeight; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, latestBlockHeight);
        
        logger.debug(`Processing rewards for blocks ${batchStart} to ${batchEnd}`);
        await this.processBatchRewards(batchStart, batchEnd);
        
        // Her batch'ten sonra son işlenen blok yüksekliğini güncelle
        await this.rewardsDBService.updateLatestProcessedBlockHeight(batchEnd);
        logger.info(`Processed rewards for blocks ${batchStart} to ${batchEnd}`);
      }

      logger.info(`Rewards calculated and distributed up to block ${latestBlockHeight}`);
    } catch (error) {
      logger.error('Error in calculateAndDistributeRewards:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to calculate and distribute rewards: ${error.message}`);
      } else {
        throw new Error('Failed to calculate and distribute rewards: Unknown error');
      }
    }
  }

  private async processBatchRewards(startBlock: number, endBlock: number): Promise<void> {
    try {
      // Blok ödüllerini ve zaman damgalarını tek seferde al
      const blocksWithRewards = await this.rewardsDBService.getBlocksWithRewards(startBlock, endBlock);
      const committees = await this.snarkOSDBService.getCommitteesForBlocks(startBlock, endBlock);
      
      const rewardUpdates: Array<{
        address: string;
        reward: bigint;
        blockHeight: bigint;
        timestamp: bigint;
        isValidator: boolean;
      }> = [];

      // Her blok için ödülleri hesapla
      for (const [height, blockData] of blocksWithRewards.entries()) {
        const committee = committees.get(height);
        if (!committee?.members) continue;

        const totalStake = this.calculateTotalStake(committee.members);
        
        // Validatör ödüllerini hesapla
        for (const [address, memberInfo] of Object.entries(committee.members)) {
          const [stake, isOpen, commission] = memberInfo;
          const memberStake = BigInt(stake);
          
          const { validatorReward, delegatorReward } = this.calculateRewards(
            memberStake,
            totalStake,
            blockData.reward,
            BigInt(commission),
            BigInt(stake) - memberStake
          );

          rewardUpdates.push({
            address,
            reward: validatorReward,
            blockHeight: BigInt(height),
            timestamp: BigInt(blockData.timestamp),
            isValidator: true
          });

          // Delegatör ödüllerini ekle
          if (isOpen) {
            const delegatorRewards = await this.calculateDelegatorRewards(
              address,
              delegatorReward,
              BigInt(height),
              BigInt(blockData.timestamp)
            );
            rewardUpdates.push(...delegatorRewards);
          }
        }
      }

      // Toplu güncelleme yap
      if (rewardUpdates.length > 0) {
        await this.rewardsDBService.bulkUpdateRewards(rewardUpdates);
        logger.info(`Processed rewards for ${rewardUpdates.length} entries in blocks ${startBlock}-${endBlock}`);
      }
    } catch (error) {
      logger.error(`Error in processBatchRewards for blocks ${startBlock}-${endBlock}:`, error);
      throw error;
    }
  }

  /* private async processBlockRewards(blockHeight: number): Promise<void> {
    const block = await this.snarkOSDBService.getBlockByHeight(blockHeight);
    if (!block) {
      logger.warn(`No block found for height ${blockHeight}`);
      return;
    }

    const blockReward = block.block_reward;
    if (!blockReward) {
      logger.warn(`No block reward found for block ${blockHeight}`);
      return;
    }

    const committee = await this.snarkOSDBService.getCommitteeForBlock(blockHeight);
    if (!committee || !committee.members) {
      logger.warn(`No committee information found for block ${blockHeight}`);
      return;
    }

    const totalStake = this.calculateTotalStake(committee.members);
    
    // Batch işlemleri için diziler
    const rewardUpdates: Array<{ 
      address: string; 
      reward: bigint; 
      blockHeight: bigint;
      timestamp: bigint;
      isValidator: boolean;
    }> = [];

    for (const [address, memberInfo] of Object.entries(committee.members)) {
      const [stake, isOpen, commission] = memberInfo;
      const memberStake = BigInt(stake);
      const totalValidatorStake = await this.snarkOSDBService.getTotalValidatorStake(address);

      if (totalValidatorStake < BigInt(10_000_000)) {
        logger.warn(`Validator ${address} has less than 10 million credits. Skipping reward calculation.`);
        continue;
      }

      const { validatorReward, delegatorReward } = this.calculateRewards(
        memberStake,
        totalStake,
        BigInt(blockReward),
        BigInt(commission),
        totalValidatorStake - memberStake
      );

      // Validatör ödülünü ekle
      rewardUpdates.push({
        address,
        reward: validatorReward,
        blockHeight: BigInt(blockHeight),
        timestamp: BigInt(block.timestamp),
        isValidator: true
      });

      // Delegatör ödüllerini hesapla ve ekle
      if (isOpen) {
        const delegators = await this.rewardsDBService.getDelegators(address);
        const totalDelegatedStake = delegators.reduce((sum, d) => sum + d.amount, BigInt(0));
        
        for (const delegator of delegators) {
          const delegatorShare = (delegator.amount * delegatorReward) / totalDelegatedStake;
          rewardUpdates.push({
            address: delegator.address,
            reward: delegatorShare,
            blockHeight: BigInt(blockHeight),
            timestamp: BigInt(block.timestamp),
            isValidator: false
          });
        }
      }
    }

    // Toplu güncelleme yap
    await Promise.all(rewardUpdates.map(update => 
      this.rewardsDBService.updateRewards(
        update.address,
        update.reward,
        update.blockHeight,
        update.timestamp,
        update.isValidator
      )
    ));
  } */

  private calculateTotalStake(members: Record<string, [number, boolean, number]>): bigint {
    return Object.values(members).reduce((sum, [stake]) => sum + BigInt(stake), BigInt(0));
  }

  private async calculateDelegatorRewards(
    validatorAddress: string, 
    totalDelegatorReward: bigint, 
    blockHeight: bigint, 
    timestamp: bigint
  ): Promise<Array<{ 
    address: string; 
    reward: bigint; 
    blockHeight: bigint; 
    timestamp: bigint;
    isValidator: boolean;  // isValidator alanını ekledik
  }>> {
    const delegators = await this.rewardsDBService.getDelegators(validatorAddress);
    const totalDelegatedStake = delegators.reduce((sum, d) => sum + d.amount, BigInt(0));
    
    return delegators.map(delegator => ({
      address: delegator.address,
      reward: (delegator.amount * totalDelegatorReward) / totalDelegatedStake,
      blockHeight,
      timestamp,
      isValidator: false  // Delegatörler için her zaman false
    }));
  }

  private calculateRewards(
    stake: bigint,
    totalStake: bigint,
    blockReward: bigint,
    commission: bigint,
    delegatedStake: bigint
  ): {
    validatorReward: bigint;
    delegatorReward: bigint;
  } {
    // Temel ödül hesaplaması - validatörün stake oranına göre
    const baseReward = (stake * blockReward) / totalStake;
    
    // Komisyon hesaplaması - delegatör stake'lerinden alınan pay
    const delegatorBaseReward = (delegatedStake * blockReward) / totalStake;
    const commissionAmount = (delegatorBaseReward * commission) / BigInt(100);
    
    // Validatör toplam ödülü = kendi stake'inden gelen ödül + komisyon
    const validatorReward = baseReward + commissionAmount;
    
    // Delegatör ödülü = delegatör stake'lerinden gelen ödül - komisyon
    const delegatorReward = delegatorBaseReward - commissionAmount;

    return { validatorReward, delegatorReward };
  }

  async getValidatorRewards(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    const rewards = await this.rewardsDBService.getRewardsInTimeRange(validatorAddress, startBlock, endBlock, true);
    return rewards.reduce((sum, reward) => sum + reward.amount, BigInt(0));
  }

  async getValidatorPerformanceMetrics(validatorAddress: string, startTime: number, endTime: number): Promise<{
    totalRewards: bigint;
    averageReward: bigint;
    rewardFrequency: number;
  }> {
    const rewards = await this.rewardsDBService.getRewardsInTimeRange(validatorAddress, startTime, endTime, true);
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

  async calculateRewardsForTimeRange(validatorAddress: string, startTime: number, endTime: number): Promise<bigint> {
    try {
      logger.debug(`Calculating rewards for time range: ${startTime} - ${endTime} for validator ${validatorAddress}`);
      
      // Doğrudan zaman aralığını kullanarak ödülleri alalım
      const rewards = await this.rewardsDBService.getRewardsInTimeRange(validatorAddress, startTime, endTime, true);
      
      const totalRewards = rewards.reduce((sum, reward) => sum + reward.amount, BigInt(0));
      
      logger.debug(`Found ${rewards.length} reward records`);
      logger.debug(`Total rewards calculated: ${totalRewards.toString()}`);
      
      return totalRewards;
    } catch (error) {
      logger.error(`Error calculating rewards for time range: ${error}`);
      throw error;
    }
  }
}

export default RewardsService;
