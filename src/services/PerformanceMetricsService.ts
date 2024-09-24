import { CacheService } from './CacheService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { AleoSDKService } from './AleoSDKService.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';

export class PerformanceMetricsService {
  private cacheService: CacheService;

  constructor(
    private readonly snarkOSDBService: SnarkOSDBService,
    private readonly aleoSDKService: AleoSDKService
  ) {
    this.cacheService = new CacheService(300, config.redis.url); // 5 min TTL
  }

  async calculateValidatorPerformance(validatorAddress: string, timeFrame: number): Promise<{
    blocksProposed: number,
    transactionsProcessed: number,
    uptime: number | null,
    averageResponseTime: number
  }> {
    try {
      const blocks = await this.snarkOSDBService.getBlocksByValidator(validatorAddress, timeFrame);
      const transactions = await this.snarkOSDBService.getTransactionsByValidator(validatorAddress, timeFrame);

      const blocksProposed = blocks.length;
      const transactionsProcessed = transactions.length;
      const uptime = await this.calculateUptime(validatorAddress);
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

  public async calculateUptime(validatorAddress: string, customTimeFrame?: number): Promise<number | null> {
    try {
      let startHeight: number;
      let endHeight: number;

      if (customTimeFrame) {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - customTimeFrame * 1000);
        [startHeight, endHeight] = await Promise.all([
          this.snarkOSDBService.getBlockHeightByTimestamp(startDate),
          this.snarkOSDBService.getBlockHeightByTimestamp(endDate)
        ]);
      } else {
        endHeight = await this.snarkOSDBService.getLatestBlockHeight();
        startHeight = Math.max(1, endHeight - config.uptime.blockRange + 1);
      }

      logger.debug(`Calculating uptime for validator ${validatorAddress} from block ${startHeight} to ${endHeight}`);

      const totalRounds = await this.snarkOSDBService.getTotalRoundsInBlockRange(startHeight, endHeight);
      logger.debug(`Total rounds in block range: ${totalRounds}`);

      if (totalRounds === 0) {
        logger.warn(`No rounds found in the block range for validator ${validatorAddress}`);
        return null;
      }

      const validatorParticipations = await this.snarkOSDBService.getValidatorParticipationsInBlockRange(validatorAddress, startHeight, endHeight);
      logger.debug(`Validator participations: ${validatorParticipations}`);

      const uptime = (validatorParticipations / totalRounds) * 100;
      logger.info(`Calculated uptime for validator ${validatorAddress}: ${uptime}%`);
      return Number(uptime.toFixed(2));

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
      uptime: performance.uptime ?? 0,
      efficiency,
      rewards: rewards.toString()
    };

    this.cacheService.set(cacheKey, result);
    return result;
  }
}