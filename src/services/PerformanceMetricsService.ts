import { CacheService } from './CacheService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { AleoSDKService } from './AleoSDKService.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import { CommitteeParticipation } from '../database/models/CommitteeParticipation.js';
import { Batch } from '../database/models/Batch.js';
import { UptimeSnapshotAttributes } from '@/database/models/UptimeSnapshot.js';

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
      const uptime = await this.calculateUptime(validatorAddress, config.uptime.calculationBlockRange); // .env'den alınan süre
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

  public async calculateUptime(validatorAddress: string, timeFrame: number = config.uptime.calculationTimeFrame): Promise<number | null> {
    try {
      const endTimestamp = Math.floor(Date.now() / 1000);
      const startTimestamp = endTimestamp - timeFrame;

      const committeeEntries: CommitteeParticipation[] = await this.snarkOSDBService.getCommitteeEntriesForValidator(validatorAddress, startTimestamp, endTimestamp);
      const validatorBatches: Batch[] = await this.snarkOSDBService.getValidatorBatches(validatorAddress, startTimestamp, endTimestamp);

      if (committeeEntries.length === 0) {
        logger.info(`Validator ${validatorAddress} was not in any committee during the specified time frame.`);
        return null;
      }

      let totalExpectedBatches = 0;
      let actualBatches = 0;

      for (let i = 0; i < committeeEntries.length; i++) {
        const entry = committeeEntries[i];
        const entryStart = entry.timestamp;
        const entryEnd = i < committeeEntries.length - 1 ? committeeEntries[i + 1].timestamp : endTimestamp;
        const entryDuration = entryEnd - entryStart;
        
        // Komite büyüklüğünü hesaplamak için ek bir sorgu gerekebilir
        const committeeSizeQuery = await this.snarkOSDBService.getCommitteeSizeForRound(entry.round);
        const committeeSize = committeeSizeQuery.committee_size;

        const expectedBatchesForEntry = Math.floor(entryDuration / config.uptime.averageBatchInterval) / committeeSize;
        totalExpectedBatches += expectedBatchesForEntry;

        const batchesInEntry = validatorBatches.filter(batch => 
          batch.timestamp >= entryStart && batch.timestamp < entryEnd
        ).length;
        actualBatches += batchesInEntry;
      }

      const uptime = (actualBatches / totalExpectedBatches) * 100;
      const uptimeSnapshot: Omit<UptimeSnapshotAttributes, 'id'> = {
        committee_member_id: committeeEntries[0].committee_member_id,
        start_round: committeeEntries[0].round,
        end_round: committeeEntries[committeeEntries.length - 1].round,
        total_rounds: committeeEntries.length,
        participated_rounds: actualBatches,
        uptime_percentage: uptime,
        calculated_at: new Date()
      };
      await this.snarkOSDBService.insertUptimeSnapshot(uptimeSnapshot);

      logger.info(`Calculated uptime for validator ${validatorAddress}: ${uptime.toFixed(2)}%`);
      return uptime;
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

  async updateUptimes(): Promise<void> {
    try {
      const validators = await this.snarkOSDBService.getActiveValidators();
      const currentRound = await this.aleoSDKService.getCurrentRound();

      logger.info(`Uptime güncelleme başladı. Aktif validator sayısı: ${validators.length}, Mevcut tur: ${currentRound}`);

      for (const validator of validators) {
        await this.calculateAndUpdateUptime(validator, currentRound);
      }

      logger.info('Uptime güncelleme tamamlandı.');
    } catch (error) {
      logger.error('Uptime güncelleme hatası:', error);
      throw error;
    }
  }

  private async calculateAndUpdateUptime(validatorAddress: string, currentRound: bigint): Promise<void> {
    try {
      const calculationRoundSpan = BigInt(config.uptime.calculationRoundSpan);

      const earliestRound = await this.snarkOSDBService.getEarliestValidatorRound(validatorAddress);
      const startRoundCandidate = currentRound > calculationRoundSpan ? currentRound - calculationRoundSpan : BigInt(0);
      const startRound = earliestRound ? (earliestRound > startRoundCandidate ? earliestRound : startRoundCandidate) : startRoundCandidate;

      if (startRound >= currentRound) {
        logger.warn(`Validator ${validatorAddress} için startRound (${startRound}) currentRound'dan (${currentRound}) büyük veya eşit.`);
        return;
      }

      const participation = await this.snarkOSDBService.getValidatorParticipation(validatorAddress, startRound, currentRound);

      const totalRounds = currentRound - startRound;
      const participatedRounds = BigInt(participation.length);

      if (totalRounds === BigInt(0)) {
        logger.warn(`Validator ${validatorAddress} için totalRounds değeri sıfır.`);
        return;
      }

      const uptimePercentage = Number(participatedRounds * BigInt(100)) / Number(totalRounds);

      await this.snarkOSDBService.updateValidatorUptime(
        validatorAddress,
        startRound,
        currentRound,
        totalRounds,
        participatedRounds,
        uptimePercentage
      );

      logger.info(`Validator ${validatorAddress} için uptime güncellendi. Uptime: ${uptimePercentage.toFixed(2)}%`);
    } catch (error) {
      logger.error(`Validator ${validatorAddress} için uptime hesaplama hatası:`, error);
      throw error;
    }
  }

  private async getLastCalculatedRound(validatorAddress: string): Promise<bigint> {
    const lastSnapshot = await this.snarkOSDBService.getLastUptimeSnapshot(validatorAddress);

    if (lastSnapshot) {
      return lastSnapshot.end_round + BigInt(1);
    } else {
      // Eğer önceki bir hesaplama yoksa, en eski turu alın
      const earliestRound = await this.snarkOSDBService.getEarliestValidatorRound(validatorAddress);
      return earliestRound ? earliestRound : BigInt(0);
    }
  }
}