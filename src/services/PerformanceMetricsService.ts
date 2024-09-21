import { CacheService } from './CacheService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';

export class PerformanceMetricsService {
  private cacheService: CacheService;

  constructor(private snarkOSDBService: SnarkOSDBService) {
    this.cacheService = new CacheService(300); // 5 min TTL
  }

  async calculateValidatorPerformance(validatorAddress: string, timeFrame: number): Promise<{
    blocksProposed: number,
    transactionsProcessed: number,
    uptime: number,
    averageResponseTime: number
  }> {
    try {
      const blocks = await this.snarkOSDBService.getBlocksByValidator(validatorAddress, timeFrame);
      const transactions = await this.snarkOSDBService.getTransactionsByValidator(validatorAddress, timeFrame);

      const blocksProposed = blocks.length;
      const transactionsProcessed = transactions.length;
      const uptime = await this.calculateUptime(validatorAddress, timeFrame);
      const averageResponseTime = await this.calculateAverageResponseTime(validatorAddress, timeFrame);

      return {
        blocksProposed,
        transactionsProcessed,
        uptime,
        averageResponseTime
      };
    } catch (error) {
      logger.error(`Error calculating performance metrics for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  private async calculateUptime(validatorAddress: string, timeFrame: number): Promise<number> {
    try {
      const totalBlocks = await this.snarkOSDBService.getTotalBlocksInTimeFrame(timeFrame);
      const validatorBlocks = await this.snarkOSDBService.getBlocksCountByValidator(validatorAddress, timeFrame);
      return (validatorBlocks / totalBlocks) * 100;
    } catch (error) {
      logger.error(`Error calculating uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  private async calculateAverageResponseTime(validatorAddress: string, timeFrame: number): Promise<number> {
    try {
      const blocks = await this.snarkOSDBService.getBlocksByValidator(validatorAddress, timeFrame);
      if (blocks.length < 2) return 0;

      let totalTimeDiff = 0;
      for (let i = 1; i < blocks.length; i++) {
        const timeDiff = Math.abs(new Date(blocks[i].timestamp).getTime() - new Date(blocks[i-1].timestamp).getTime());
        totalTimeDiff += timeDiff;
      }

      return totalTimeDiff / (blocks.length - 1);
    } catch (error) {
      logger.error(`Error calculating average response time for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorEfficiency(validatorAddress: string, timeFrame: number): Promise<number> {
    const cacheKey = `validator_efficiency_${validatorAddress}_${timeFrame}`;
    const cachedData = this.cacheService.get(cacheKey);
    if (cachedData !== undefined) {
      return cachedData;
    }

    try {
      const [blocksProduced, totalBlocks] = await Promise.all([
        this.snarkOSDBService.getBlocksCountByValidator(validatorAddress, timeFrame),
        this.snarkOSDBService.getTotalBlocksInTimeFrame(timeFrame)
      ]);

      const totalValidatorsCount = await this.getTotalValidatorsCount();
      if (typeof totalValidatorsCount !== 'number' || totalValidatorsCount <= 0) {
        throw new Error('Invalid total validators count');
      }

      const expectedBlocks = Math.floor(totalBlocks / totalValidatorsCount);
      const efficiency = (blocksProduced / expectedBlocks) * 100;

      this.cacheService.set(cacheKey, efficiency);
      return efficiency;
    } catch (error) {
      logger.error(`Error calculating validator efficiency for ${validatorAddress}:`, error);
      throw error;
    }
  }

  private async getTotalValidatorsCount(): Promise<number> {
    const cacheKey = 'total_validators_count';
    const cachedCount = this.cacheService.get(cacheKey);
    if (cachedCount !== undefined) {
      return cachedCount;
    }

    const count = await this.snarkOSDBService.getTotalValidatorsCount();
    this.cacheService.set(cacheKey, count);
    return count;
  }

  async getValidatorRewards(validatorAddress: string, timeFrame: number): Promise<bigint> {
    try {
      const blocks = await this.snarkOSDBService.getBlocksByValidator(validatorAddress, timeFrame);
      return blocks.reduce((sum, block) => sum + BigInt(block.total_fees || 0), BigInt(0));
    } catch (error) {
      logger.error(`Error calculating rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorPerformanceSummary(validatorAddress: string, timeFrame: number): Promise<{
    blocksProposed: number,
    transactionsProcessed: number,
    uptime: number,
    averageResponseTime: number,
    efficiency: number,
    rewards: string
  }> {
    const cacheKey = `performance_${validatorAddress}_${timeFrame}`;
    const cachedData = this.cacheService.get(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const [performance, efficiency, rewards] = await Promise.all([
      this.calculateValidatorPerformance(validatorAddress, timeFrame),
      this.getValidatorEfficiency(validatorAddress, timeFrame),
      this.getValidatorRewards(validatorAddress, timeFrame)
    ]);

    const result = {
      ...performance,
      efficiency,
      rewards: rewards.toString()
    };

    this.cacheService.set(cacheKey, result);
    return result;
  }
}