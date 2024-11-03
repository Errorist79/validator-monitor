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

  private calculateRewards(
    stake: bigint,
    totalStake: bigint,
    blockReward: bigint,
    commission: bigint,
    delegatedStake: bigint
  ): {
    selfStakeReward: bigint;
    commissionReward: bigint;
    delegatorReward: bigint;
    totalValidatorReward: bigint;
  } {
    // Temel ödül hesaplaması - toplam stake oranına göre
    const totalStakeReward = (stake + delegatedStake) * blockReward / totalStake;
    
    // Self-stake ödülü
    const selfStakeReward = stake * totalStakeReward / (stake + delegatedStake);
    
    // Delegatör ödülü (komisyon öncesi)
    const delegatorBaseReward = delegatedStake * totalStakeReward / (stake + delegatedStake);
    
    // Komisyon hesaplaması
    const commissionReward = (delegatorBaseReward * commission) / BigInt(100);
    
    // Nihai delegatör ödülü (komisyon sonrası)
    const delegatorReward = delegatorBaseReward - commissionReward;
    
    // Validatörün toplam ödülü = self-stake + komisyon
    const totalValidatorReward = selfStakeReward + commissionReward;

    return {
      selfStakeReward,
      commissionReward,
      delegatorReward,
      totalValidatorReward
    };
  }

  private async processBatchRewards(startBlock: number, endBlock: number): Promise<void> {
    try {
      const blocksWithRewards = await this.rewardsDBService.getBlocksWithRewards(startBlock, endBlock);
      const committees = await this.snarkOSDBService.getCommitteesForBlocks(startBlock, endBlock);
      
      const rewardUpdates: Array<{
        address: string;
        reward: bigint;
        selfStakeReward: bigint;
        commissionReward: bigint;
        delegatorReward: bigint;
        blockHeight: bigint;
        timestamp: bigint;
        isValidator: boolean;
      }> = [];

      for (const [height, blockData] of blocksWithRewards.entries()) {
        const committee = committees.get(height);
        if (!committee?.members) continue;

        const totalStake = this.calculateTotalStake(committee.members);
        
        for (const [address, memberInfo] of Object.entries(committee.members)) {
          const [totalStakeAmount, isOpen, commission, selfStakeAmount] = memberInfo;
          const selfStake = BigInt(selfStakeAmount);
          const delegatedStake = BigInt(totalStakeAmount) - selfStake;

          // Ödülleri hesapla
          const rewards = this.calculateRewards(
            selfStake,
            totalStake,
            blockData.reward,
            BigInt(commission),
            delegatedStake
          );

          // Validatör kaydını ekle
          rewardUpdates.push({
            address,
            reward: rewards.totalValidatorReward,
            selfStakeReward: rewards.selfStakeReward,
            commissionReward: rewards.commissionReward,
            delegatorReward: BigInt(0), // Validatör kaydında delegator reward 0
            blockHeight: BigInt(height),
            timestamp: BigInt(blockData.timestamp),
            isValidator: true
          });

          // Eğer validatör açıksa ve delegatör ödülü varsa
          if (isOpen && rewards.delegatorReward > BigInt(0)) {
            rewardUpdates.push({
              address: `${address}_delegators`,
              reward: rewards.delegatorReward,
              selfStakeReward: BigInt(0),
              commissionReward: BigInt(0),
              delegatorReward: rewards.delegatorReward,
              blockHeight: BigInt(height),
              timestamp: BigInt(blockData.timestamp),
              isValidator: false
            });
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

  private calculateTotalStake(members: Record<string, [number, boolean, number, number]>): bigint {
    return Object.values(members).reduce((sum, [totalStake]) => sum + BigInt(totalStake), BigInt(0));
  }

/*   private async calculateDelegatorRewards(
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
  } */

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
