import { CacheService } from './CacheService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { AleoSDKService } from './AleoSDKService.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import syncEvents from '../events/SyncEvents.js';
import { BlockSyncService } from './BlockSyncService.js';
import { UptimeSnapshotAttributes } from '../database/models/UptimeSnapshot.js';
import pLimit from 'p-limit';
import { CommitteeData } from '../database/models/CommitteeParticipation.js';



export class PerformanceMetricsService {
  private lastProcessedHeight: number = 0;
  private isInitialSyncCompleted: boolean = false;
  private readonly SYNC_START_BLOCK: number;
  private readonly CALCULATION_INTERVAL: number;
  private readonly CALCULATION_ROUND_SPAN: number;
  private readonly CONCURRENCY_LIMIT: number;

  constructor(
    private snarkOSDBService: SnarkOSDBService,
    private aleoSDKService: AleoSDKService,
    private blockSyncService: BlockSyncService,
    private cacheService: CacheService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    this.CALCULATION_INTERVAL = config.uptime.calculationInterval;
    this.CALCULATION_ROUND_SPAN = config.uptime.calculationRoundSpan;
    this.CONCURRENCY_LIMIT = config.performance.concurrencyLimit;
    this.setupEventListeners();
    this.startPeriodicUptimeCalculation();
  }

  private setupEventListeners(): void {
    syncEvents.on('initialSyncCompleted', async () => {
      logger.info('Initial sync completed, starting full uptime calculation');
      this.isInitialSyncCompleted = true;
      await this.performFullUptimeCalculation();
    });

    syncEvents.on('regularSyncCompleted', async () => {
      if (this.isInitialSyncCompleted) {
        logger.info('Regular sync completed, starting incremental uptime calculation');
        await this.performIncrementalUptimeCalculation();
      }
    });

    syncEvents.on('batchAndParticipationProcessed', async ({ startHeight, endHeight }) => {
      if (this.isInitialSyncCompleted) {
        logger.debug(`Batch and participation processed for heights ${startHeight} to ${endHeight}, updating uptimes`);
        await this.updateUptimes();
      }
    });
  }

  private startPeriodicUptimeCalculation(): void {
    setInterval(async () => {
      if (this.isInitialSyncCompleted) {
        logger.info('Starting periodic uptime calculation');
        await this.performIncrementalUptimeCalculation();
      }
    }, this.CALCULATION_INTERVAL);
  }

  private async performFullUptimeCalculation(): Promise<void> {
    const latestBlockHeight = await this.aleoSDKService.getLatestBlockHeight();
    logger.info(`Performing full uptime calculation up to block height ${latestBlockHeight}`);

    // Veritabanındaki son bloğu kontrol et
    const lastSyncedHeight = await this.snarkOSDBService.getLatestBlockHeight();
    if (lastSyncedHeight < latestBlockHeight) {
      logger.warn(`Database is not fully synced. Expected: ${latestBlockHeight}, Actual: ${lastSyncedHeight}`);
      return;
    }

    // Uptime hesaplaması için gerekli verilerin varlığını kontrol et
    const dataAvailable = await this.checkRequiredDataAvailability(this.SYNC_START_BLOCK, latestBlockHeight);
    if (!dataAvailable) {
      logger.warn('Required data for uptime calculation is not available');
      return;
    }

    await this.updateUptimes();
  }

  private async checkRequiredDataAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    // Gerekli verilerin varlığını kontrol et (örneğin, komiteler, imzalar, batch'ler)
    const committeesAvailable = await this.snarkOSDBService.checkCommitteesAvailability(startHeight, endHeight);
    const signaturesAvailable = await this.snarkOSDBService.checkSignaturesAvailability(startHeight, endHeight);
    const batchesAvailable = await this.snarkOSDBService.checkBatchesAvailability(startHeight, endHeight);

    return committeesAvailable && signaturesAvailable && batchesAvailable;
  }

  private async performIncrementalUptimeCalculation(): Promise<void> {
    const latestBlockHeight = await this.blockSyncService.getLatestSyncedBlockHeight();
    logger.info(`Performing incremental uptime calculation up to block height ${latestBlockHeight}`);
    await this.updateUptimes();
  }

  async updateUptimes(): Promise<void> {
    try {
      const validators = await this.snarkOSDBService.getActiveValidators();
      const currentRound = await this.aleoSDKService.getCurrentRound();

      logger.info(`Starting uptime update. Active validators: ${validators.length}, Current round: ${currentRound}`);

      const limit = pLimit(this.CONCURRENCY_LIMIT);
      const updatePromises = validators.map(validator => 
        limit(() => this.calculateAndUpdateUptime(validator, currentRound))
      );

      await Promise.all(updatePromises);

      logger.info('Uptime update completed');
    } catch (error) {
      logger.error('Error during uptime update:', error);
      throw error;
    }
  }

  private async calculateAndUpdateUptime(validatorAddress: string, currentRound: bigint): Promise<void> {
    try {
      const startRound = await this.determineStartRound(validatorAddress, currentRound);

      if (startRound >= currentRound) {
        logger.debug(`Validator ${validatorAddress}: startRound (${startRound}) >= currentRound (${currentRound}). Skipping.`);
        return;
      }

      logger.debug(`Calculating uptime for validator ${validatorAddress} from round ${startRound} to ${currentRound}`);

      const [totalCommitteesList, validatorBatchParticipation, validatorSignatureParticipation] = await Promise.all([
        this.snarkOSDBService.getTotalCommittees(startRound, currentRound),
        this.snarkOSDBService.getValidatorParticipation(validatorAddress, startRound, currentRound),
        this.snarkOSDBService.getSignatureParticipation(validatorAddress, startRound, currentRound)
      ]);

      const uptimeData = this.processUptimeData(totalCommitteesList, validatorBatchParticipation, validatorSignatureParticipation);

      await this.updateUptimeInDatabase(validatorAddress, startRound, currentRound, uptimeData);

      logger.info(`Uptime calculated for validator ${validatorAddress}: ${uptimeData.uptimePercentage.toFixed(2)}%`);
    } catch (error) {
      logger.error(`Error calculating uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  private async determineStartRound(validatorAddress: string, currentRound: bigint): Promise<bigint> {
    const calculationRoundSpan = BigInt(this.CALCULATION_ROUND_SPAN);
    const startRoundCandidate = currentRound > calculationRoundSpan ? currentRound - calculationRoundSpan : BigInt(0);

    const earliestRound = await this.snarkOSDBService.getEarliestValidatorRound(validatorAddress);
    return earliestRound ? (earliestRound > startRoundCandidate ? earliestRound : startRoundCandidate) : startRoundCandidate;
  }

  private processUptimeData(
    totalCommitteesList: CommitteeData[], 
    validatorBatchParticipation: CommitteeData[], 
    validatorSignatureParticipation: CommitteeData[]
  ): {
    participatedCommitteesCount: number;
    totalCommitteesCount: number;
    uptimePercentage: number;
  } {
    const totalCommitteesCount = totalCommitteesList.length;
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
      const participatedRounds = participatedCommittees.get(committee.committee_id);
      if (participatedRounds) {
        for (const round of committee.rounds) {
          if (participatedRounds.has(round)) {
            participatedCommitteesCount++;
            break;
          }
        }
      }
    }

    const uptimePercentage = totalCommitteesCount > 0 
      ? (participatedCommitteesCount / totalCommitteesCount) * 100 
      : 0;

    return {
      participatedCommitteesCount,
      totalCommitteesCount,
      uptimePercentage
    };
  }

  private async updateUptimeInDatabase(validatorAddress: string, startRound: bigint, currentRound: bigint, uptimeData: {
    participatedCommitteesCount: number;
    totalCommitteesCount: number;
    uptimePercentage: number;
  }): Promise<void> {
    await this.snarkOSDBService.updateValidatorUptime(
      validatorAddress,
      startRound,
      currentRound,
      BigInt(uptimeData.totalCommitteesCount),
      BigInt(uptimeData.participatedCommitteesCount),
      uptimeData.uptimePercentage
    );

    const uptimeSnapshot: Omit<UptimeSnapshotAttributes, 'id'> = {
      validator_address: validatorAddress,
      start_round: startRound,
      end_round: currentRound,
      total_rounds: uptimeData.totalCommitteesCount,
      participated_rounds: uptimeData.participatedCommitteesCount,
      uptime_percentage: uptimeData.uptimePercentage,
      calculated_at: new Date()
    };

    await this.snarkOSDBService.insertUptimeSnapshot(uptimeSnapshot);
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

      await this.cacheService.set(cacheKey, efficiency);
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

  // TODO: Implement getValidatorPerformanceSummary method
  // async getValidatorPerformanceSummary(validatorAddress: string, timeFrame: number): Promise<PerformanceSummary> {
  //   // Implementation goes here
  // }
}

export default PerformanceMetricsService;