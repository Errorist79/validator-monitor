import { CacheService } from './CacheService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { AleoSDKService } from './AleoSDKService.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import syncEvents from '../events/SyncEvents.js';
import { BlockSyncService } from './BlockSyncService.js';
import { UptimeSnapshotAttributes } from '../database/models/UptimeSnapshot.js';
import pLimit from 'p-limit';

export class PerformanceMetricsService {
  private lastProcessedHeight: number = 0;
  private isInitialSyncCompleted: boolean = false;
  private readonly SYNC_START_BLOCK: number;

  constructor(
    private snarkOSDBService: SnarkOSDBService,
    private aleoSDKService: AleoSDKService,
    private blockSyncService: BlockSyncService,
    private cacheService: CacheService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    this.setupEventListeners();
    this.startPeriodicUptimeCalculation();
  }

  private setupEventListeners(): void {
    syncEvents.on('initialSyncCompleted', async () => {
      this.isInitialSyncCompleted = true;
      await this.performFullUptimeCalculation();
    });

    syncEvents.on('regularSyncCompleted', async () => {
      if (this.isInitialSyncCompleted) {
        await this.performIncrementalUptimeCalculation();
      }
    });

    syncEvents.on('batchAndParticipationProcessed', async ({ startHeight, endHeight }) => {
      if (this.isInitialSyncCompleted) {
        await this.updateUptimes();
      }
    });
  }

  private startPeriodicUptimeCalculation(): void {
    setInterval(async () => {
      if (this.isInitialSyncCompleted) {
        await this.performIncrementalUptimeCalculation();
      }
    }, config.uptime.calculationInterval);
  }

  private async performFullUptimeCalculation(): Promise<void> {
    const latestBlockHeight = await this.blockSyncService.getLatestSyncedBlockHeight();
    await this.updateUptimes();
  }

  private async performIncrementalUptimeCalculation(): Promise<void> {
    const latestBlockHeight = await this.blockSyncService.getLatestSyncedBlockHeight();
    await this.updateUptimes();
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
      const startRoundCandidate = currentRound > calculationRoundSpan ? currentRound - calculationRoundSpan : BigInt(0);

      const earliestRound = await this.snarkOSDBService.getEarliestValidatorRound(validatorAddress);
      const startRound = earliestRound ? (earliestRound > startRoundCandidate ? earliestRound : startRoundCandidate) : startRoundCandidate;

      if (startRound >= currentRound) {
        logger.warn(`Validator ${validatorAddress}: startRound (${startRound}) >= currentRound (${currentRound}).`);
        return;
      }

      logger.debug(`Validator ${validatorAddress}: Calculating uptime from round ${startRound} to ${currentRound}.`);

      // Toplam komiteleri alıyoruz (tur bazlı)
      const totalCommitteesList = await this.snarkOSDBService.getTotalCommittees(startRound, currentRound);
      const totalCommitteesCount = totalCommitteesList.length;

      logger.debug(`Validator ${validatorAddress}: Total committees count between rounds ${startRound} and ${currentRound}: ${totalCommitteesCount}`);

      if (totalCommitteesCount === 0) {
        logger.warn(`Validator ${validatorAddress}: No committees found between rounds ${startRound} and ${currentRound}.`);
        return;
      }

      // Validator'ın katılımlarını alıyoruz (tur bazlı)
      const validatorBatchParticipation = await this.snarkOSDBService.getValidatorParticipation(validatorAddress, startRound, currentRound);
      const validatorSignatureParticipation = await this.snarkOSDBService.getSignatureParticipation(validatorAddress, startRound, currentRound);

      // Uptime hesaplamasında katılımları birleştiriyoruz
      const participatedCommittees = new Map<string, Set<bigint>>();

      for (const vp of validatorBatchParticipation) {
        participatedCommittees.set(vp.committee_id, new Set(vp.rounds));
      }

      for (const sp of validatorSignatureParticipation) {
        if (!participatedCommittees.has(sp.committee_id)) {
          participatedCommittees.set(sp.committee_id, new Set());
        }
        const roundsSet = participatedCommittees.get(sp.committee_id)!;
        for (const round of sp.rounds) {
          roundsSet.add(round);
        }
      }

      let participatedCommitteesCount = 0;

      for (const committee of totalCommitteesList) {
        const validatorRounds = participatedCommittees.get(committee.committee_id) || new Set<bigint>();

        const intersection = committee.rounds.filter((round: bigint) => validatorRounds.has(round));

        if (intersection.length > 0) {
          participatedCommitteesCount++;
        } else {
          logger.info(`Validator ${validatorAddress} did not participate in committee ${committee.committee_id} spanning rounds ${committee.rounds.join(', ')}`);
        }
      }

      const uptimePercentage = (participatedCommitteesCount / totalCommitteesCount) * 100;

      // Uptime değerini güncelliyoruz
      await this.snarkOSDBService.updateValidatorUptime(
        validatorAddress,
        startRound,
        currentRound,
        BigInt(totalCommitteesCount),
        BigInt(participatedCommitteesCount),
        uptimePercentage
      );

      const uptimeSnapshot: Omit<UptimeSnapshotAttributes, 'id'> = {
        validator_address: validatorAddress,
        start_round: startRound,
        end_round: currentRound,
        total_rounds: totalCommitteesCount,
        participated_rounds: participatedCommitteesCount,
        uptime_percentage: uptimePercentage,
        calculated_at: new Date()
      };

      await this.snarkOSDBService.insertUptimeSnapshot(uptimeSnapshot);

      logger.info(`Uptime calculated for validator ${validatorAddress}: ${uptimePercentage.toFixed(2)}%`);
    } catch (error) {
      logger.error(`Validator ${validatorAddress}: Error calculating uptime:`, error);
      throw error;
    }
  }

  async getValidatorEfficiency(validatorAddress: string, timeFrame: number): Promise<number> {
    const cacheKey = `validator_efficiency_${validatorAddress}_${timeFrame}`;
    const cachedData = await this.cacheService.get(cacheKey);
    if (cachedData !== null) {
      return Number(cachedData);
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

      await this.cacheService.set(cacheKey, efficiency); // await eklendi
      return efficiency;
    } catch (error) {
      logger.error(`Error calculating validator efficiency for ${validatorAddress}:`, error);
      throw error;
    }
  }

  private async getTotalValidatorsCount(): Promise<number> {
    const cacheKey = 'total_validators_count';
    const cachedCount = await this.cacheService.get(cacheKey);
    if (cachedCount !== null) {
      return Number(cachedCount);
    }

    const count = await this.snarkOSDBService.getTotalValidatorsCount();
    await this.cacheService.set(cacheKey, count);
    return count;
  }

  /* async getValidatorPerformanceSummary(validatorAddress: string, timeFrame: number): Promise<{
    blocksProposed: number,
    transactionsProcessed: number,
    uptime: number,
    averageResponseTime: number,
    efficiency: number,
    rewards: string
  }> {
    const cacheKey = `performance_${validatorAddress}_${timeFrame}`;
    const cachedData = await this.cacheService.get(cacheKey); // await eklendi

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

    await this.cacheService.set(cacheKey, result); // await eklendi
    return result;
  } */
}