import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { APIBlock, APIBatch, BlockAttributes } from '../database/models/Block.js';
import { BatchAttributes } from '../database/models/Batch.js';
import { sleep } from '../utils/helpers.js';
import { config } from '../config/index.js';
import { CommitteeMapping, BondedMapping, DelegatedMapping } from '../database/models/Mapping.js';
import syncEvents from '../events/SyncEvents.js';
import { initializeWasm, getAddressFromSignature } from 'aleo-address-derivation';
import { CacheService } from './CacheService.js';
import pLimit from 'p-limit';
import { BaseDBService } from './database/BaseDBService';

export class BlockSyncService {
  private readonly INITIAL_BATCH_SIZE = 30;
  private readonly MAX_BATCH_SIZE = 50;
  private readonly MIN_BATCH_SIZE = 10;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 seconds
  private readonly SYNC_START_BLOCK: number;
  private readonly SYNC_THRESHOLD = 10;
  private readonly MAX_CONCURRENT_BATCHES = 5;
  private readonly RATE_LIMIT = 10; // Maximum requests per second
  private readonly RATE_LIMIT_WINDOW = 1000; // 1 second
  private isSyncing: boolean = false;
  private isFullySynchronized: boolean = false;
  private lastSyncedBlockHeight: number = 0;
  private previousSyncedBlockHeight: number = 0;
  private currentBatchSize: number;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private lastRegularSyncCompletedTime: number = 0;
  private readonly REGULAR_SYNC_INTERVAL: number = 5 * 60 * 1000; // 5 dakika (milisaniye cinsinden)

  private processingQueue: Array<{ startHeight: number; endHeight: number }> = [];
  private isProcessing: boolean = false;

  private readonly BASE_SYNC_INTERVAL = 50000; // 50 saniye
  private readonly MAX_SYNC_INTERVAL = 300000; // 5 dakika
  private readonly MIN_SYNC_INTERVAL = 30000; // 30 saniye
  private lastSyncTime: number = 0;

  private tokenBucket = {
    tokens: this.RATE_LIMIT,
    lastRefill: Date.now()
  };

  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private cacheService: CacheService,
    private baseDBService: BaseDBService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    this.currentBatchSize = this.INITIAL_BATCH_SIZE;
    initializeWasm(); // Initialize WASM
    this.initializeLastSyncedBlockHeight();
  }

  private async initializeLastSyncedBlockHeight(): Promise<void> {
    this.lastSyncedBlockHeight = await this.getLatestSyncedBlockHeight();
  }

  async startSyncProcess(): Promise<void> {
    await this.initialSync();
    this.startRegularSync();
  }

  private async initialSync(): Promise<void> {
    this.isSyncing = true;
    try {
      const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();
      if (latestNetworkBlock === null) {
        throw new Error('Failed to get latest network block height');
      }

      const startHeight = Math.max(await this.getLatestSyncedBlockHeight(), this.SYNC_START_BLOCK);
      const endHeight = latestNetworkBlock;

      const limit = pLimit(this.MAX_CONCURRENT_BATCHES);
      const tasks = [];

      for (let height = startHeight; height <= endHeight; height += this.currentBatchSize) {
        const batchEndHeight = Math.min(height + this.currentBatchSize - 1, endHeight);
        tasks.push(limit(() => this.syncBlockRangeWithRetry(height, batchEndHeight)));
      }

      await Promise.all(tasks);

      this.isFullySynchronized = true;
      logger.info('Initial sync completed, starting full uptime calculation');
      syncEvents.emit('initialSyncCompleted');
    } catch (error) {
      logger.error('Initial sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private startRegularSync(): void {
    const adaptiveSync = async () => {
      const now = Date.now();
      const timeSinceLastSync = now - this.lastSyncTime;
      const nextSyncDelay = this.calculateNextSyncDelay();

      if (timeSinceLastSync < nextSyncDelay) {
        setTimeout(adaptiveSync, nextSyncDelay - timeSinceLastSync);
        return;
      }

      this.lastSyncTime = now;

      if (this.isSyncing) return;
      this.isSyncing = true;
      try {
        const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();
        if (latestNetworkBlock === null) {
          throw new Error('Failed to get latest network block height');
        }

        const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
        if (latestNetworkBlock > latestSyncedBlock) {
          this.previousSyncedBlockHeight = this.lastSyncedBlockHeight;
          await this.syncBlockRange(latestSyncedBlock + 1, latestNetworkBlock);
          this.lastSyncedBlockHeight = latestNetworkBlock;
          logger.info(`Blocks synchronized up to height ${latestNetworkBlock}`);
        }

        if (this.isFullySynchronized) {
          const currentTime = Date.now();
          if (currentTime - this.lastRegularSyncCompletedTime >= this.REGULAR_SYNC_INTERVAL) {
            syncEvents.emit('regularSyncCompleted');
            this.lastRegularSyncCompletedTime = currentTime;
            logger.info('Regular sync completed, event emitted');
          } else {
            logger.debug('Regular sync completed, but event not emitted due to time interval');
          }
        }
      } catch (error) {
        logger.error('Regular synchronization failed:', error);
      } finally {
        this.isSyncing = false;
      }

      setTimeout(adaptiveSync, this.calculateNextSyncDelay());
    };

    adaptiveSync();
  }

  private calculateNextSyncDelay(): number {
    const processedBlocks = this.lastSyncedBlockHeight - this.previousSyncedBlockHeight;

    let interval = this.BASE_SYNC_INTERVAL;

    if (processedBlocks > 100) {
      // Ağ çok yoğun, aralığı azalt
      interval = Math.max(interval / 2, this.MIN_SYNC_INTERVAL);
    } else if (processedBlocks < 10) {
      // Ağ yavaş, aralığı artır
      interval = Math.min(interval * 2, this.MAX_SYNC_INTERVAL);
    }

    return interval;
  }

  public async syncLatestBlocks(): Promise<void> {
    try {
      const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();
      if (latestNetworkBlock === null) {
        logger.warn('Failed to get latest network block height');
        return;
      }

      let startHeight = await this.getLatestSyncedBlockHeight();
      
      if (latestNetworkBlock > startHeight) {
        await this.syncBlockRange(startHeight + 1, latestNetworkBlock);
        logger.info(`Blocks synchronized up to height ${latestNetworkBlock}`);
      } else {
        logger.info('Blocks are already up to date');
      }
      
      const isSynchronized = await this.isDataSynchronized();
      if (isSynchronized) {
        this.isFullySynchronized = true;
        syncEvents.emit('dataSynchronized');
      }
      syncEvents.emit('validatorsUpdated');
    } catch (error) {
      logger.error('Error during block sync:', error);
      throw error;
    }
  }

  private async syncBlockRange(startHeight: number, endHeight: number): Promise<void> {
    const maxBlocksPerRequest = 50; // API'nin izin verdiği maksimum blok sayısı
    const limit = pLimit(this.MAX_CONCURRENT_BATCHES);
    const tasks = [];

    for (let height = startHeight; height <= endHeight; height += maxBlocksPerRequest) {
      const batchEndHeight = Math.min(height + maxBlocksPerRequest - 1, endHeight);
      tasks.push(limit(() => this.syncBlockRangeWithRetry(height, batchEndHeight)));
    }

    await Promise.all(tasks);
    this.adjustBatchSize();
  }

  private async syncBlockRangeWithRetry(startHeight: number, endHeight: number, retries: number = 0): Promise<void> {
    try {
      await this.rateLimit();
      const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
      const processedData = await this.processBlocks(blocks);
      await this.bulkInsertData(processedData);
      logger.info(`Blocks synchronized between ${startHeight} and ${endHeight}`);
    } catch (error) {
      if (retries < this.MAX_RETRIES) {
        const delay = Math.pow(2, retries) * this.RETRY_DELAY;
        logger.warn(`Retrying block range ${startHeight}-${endHeight}, attempt ${retries + 1}. Waiting for ${delay}ms`);
        await sleep(delay);
        await this.syncBlockRangeWithRetry(startHeight, endHeight, retries + 1);
      } else {
        logger.error(`Failed to synchronize block range ${startHeight}-${endHeight} after ${this.MAX_RETRIES} attempts:`, error);
        throw error;
      }
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timePassed = now - this.tokenBucket.lastRefill;
    this.tokenBucket.tokens = Math.min(
      this.RATE_LIMIT,
      this.tokenBucket.tokens + timePassed * (this.RATE_LIMIT / this.RATE_LIMIT_WINDOW)
    );
    this.tokenBucket.lastRefill = now;

    if (this.tokenBucket.tokens < 1) {
      const waitTime = ((1 - this.tokenBucket.tokens) / this.RATE_LIMIT) * this.RATE_LIMIT_WINDOW;
      await sleep(waitTime);
    }
    this.tokenBucket.tokens -= 1;
  }

  private adjustBatchSize(): void {
    // Simple adaptive batch size adjustment algorithm
    if (this.isSyncing) {
      this.currentBatchSize = Math.min(this.currentBatchSize * 1.2, this.MAX_BATCH_SIZE);
    } else {
      this.currentBatchSize = Math.max(this.currentBatchSize * 0.8, this.MIN_BATCH_SIZE);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) return;

    this.isProcessing = true;
    const { startHeight, endHeight } = this.processingQueue.shift()!;

    try {
      await this.processSingleBlockRange(startHeight, endHeight);
      syncEvents.emit('batchAndParticipationProcessed', { startHeight, endHeight });
    } catch (error) {
      logger.error(`Error processing block range ${startHeight}-${endHeight}:`, error);
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }

  private async processSingleBlockRange(startHeight: number, endHeight: number): Promise<void> {
    const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
    const processedData = await this.processBlocks(blocks);
    await this.bulkInsertData(processedData);
    
    logger.info(`Blocks processed between ${startHeight} and ${endHeight}`);
    
    // Emit an event when a block range is processed
    syncEvents.emit('batchAndParticipationProcessed', { startHeight, endHeight });
  }

  private async processBlocks(blocks: APIBlock[]): Promise<{
    blockAttributesList: any[];
    committeeMembers: any[];
    batchInfos: any[];
    committeeParticipations: any[];
    signatureParticipations: any[];
  }> {
    const blockAttributesList = blocks.map(block => this.aleoSDKService.convertToBlockAttributes(block));
    const committeeMembers = [];
    const batchInfos = [];
    const committeeParticipations = [];
    const signatureParticipations = [];

    for (const block of blocks) {
      const extractedData = await this.extractBatchAndParticipationData(block);
      committeeMembers.push(...extractedData.committeeMembers);
      batchInfos.push(...extractedData.batchInfos);
      committeeParticipations.push(...extractedData.committeeParticipations);
      signatureParticipations.push(...extractedData.signatureParticipations);
    }

    return {
      blockAttributesList,
      committeeMembers,
      batchInfos,
      committeeParticipations,
      signatureParticipations
    };
  }

  private async bulkInsertData(processedData: {
    blockAttributesList: BlockAttributes[];
    committeeMembers: any[];
    batchInfos: any[];
    committeeParticipations: any[];
    signatureParticipations: any[];
  }): Promise<void> {
    const client = await this.baseDBService.getClient();
    try {
      await client.query('BEGIN');
  
      if (processedData.blockAttributesList.length > 0) {
        await this.snarkOSDBService.upsertBlocks(processedData.blockAttributesList, client);
      }
  
      if (processedData.batchInfos.length > 0) {
        await this.snarkOSDBService.bulkInsertBatchInfos(processedData.batchInfos, client);
      }
  
      if (processedData.committeeMembers.length > 0) {
        await this.snarkOSDBService.bulkInsertCommitteeMembers(processedData.committeeMembers, client);
      }
  
      if (processedData.committeeParticipations.length > 0) {
        await this.snarkOSDBService.bulkInsertCommitteeParticipations(processedData.committeeParticipations, client);
      }
  
      if (processedData.signatureParticipations.length > 0) {
        await this.snarkOSDBService.bulkInsertSignatureParticipations(processedData.signatureParticipations, client);
      }
  
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error in bulkInsertData operation:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async getMappings(author: string): Promise<{
    committeeMapping: CommitteeMapping | null;
    bondedMapping: BondedMapping | null;
    delegatedMapping: DelegatedMapping | null;
  }> {
    const cacheKey = `mappings_${author}`;
    let mappings = await this.cacheService.get<{
      committeeMapping: CommitteeMapping | null;
      bondedMapping: BondedMapping | null;
      delegatedMapping: DelegatedMapping | null;
    }>(cacheKey);
  
    if (!mappings) {
      try {
        mappings = await this.aleoSDKService.getMappings(author);
        await this.cacheService.set(cacheKey, mappings, 3600); // 1 hour caching
      } catch (error) {
        logger.error(`Error retrieving mappings for author ${author}:`, error);
        // Return default null mappings in case of an error
        mappings = {
          committeeMapping: null,
          bondedMapping: null,
          delegatedMapping: null
        };
      }
    }
  
    return mappings;
  }

  public async isDataSynchronized(): Promise<boolean> {
    const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
    const latestProcessedBlock = await this.snarkOSDBService.getLatestProcessedBlockHeight();
    const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();

    if (latestNetworkBlock === null) {
      logger.warn('Failed to get latest network block height');
      return false;
    }

    const syncDifference = latestNetworkBlock - latestSyncedBlock;
    const processDifference = latestSyncedBlock - latestProcessedBlock;

    return syncDifference <= this.SYNC_THRESHOLD && processDifference <= this.SYNC_THRESHOLD;
  }

  private async extractBatchAndParticipationData(block: APIBlock): Promise<{
    committeeMembers: any[],
    batchInfos: any[],
    committeeParticipations: any[],
    signatureParticipations: any[]
  }> {
    const blockHeight = parseInt(block.header.metadata.height);

    const committeeMembers = [];
    const batchInfos = [];
    const committeeParticipations = [];
    const signatureParticipations = [];

    for (const roundKey in block.authority.subdag.subdag) {
      const batches = block.authority.subdag.subdag[roundKey];
      for (const batch of batches) {
        const batchKey = batch.batch_header.batch_id;
        const author = batch.batch_header.author;

        // Fetch mappings for the author
        const mappings = await this.getMappings(author);

        if (mappings.committeeMapping && mappings.bondedMapping) {
          const totalStake = mappings.bondedMapping.microcredits + (mappings.delegatedMapping ? mappings.delegatedMapping.microcredits : BigInt(0));

          // Committee Members
          committeeMembers.push({
            address: author,
            first_seen_block: blockHeight,
            last_seen_block: blockHeight,
            total_stake: totalStake.toString(),
            is_open: mappings.committeeMapping.is_open,
            commission: BigInt(mappings.committeeMapping.commission).toString(),
            is_active: true,
            block_height: blockHeight
          });
        }

        // Batch Infos
        batchInfos.push({
          batch_id: batchKey,
          author,
          block_height: blockHeight,
          round: parseInt(roundKey),
          timestamp: Number(batch.batch_header.timestamp),
          committee_id: batch.batch_header.committee_id || 'unknown'
        });

        // Committee Participations
        committeeParticipations.push({
          validator_address: author,
          committee_id: batch.batch_header.committee_id,
          round: parseInt(roundKey),
          block_height: blockHeight,
          timestamp: Number(batch.batch_header.timestamp)
        });

        // Signature Participations
        if (batch.signatures) {
          for (const signature of batch.signatures) {
            const validatorAddress = getAddressFromSignature(signature);
            signatureParticipations.push({
              validator_address: validatorAddress,
              batch_id: batchKey,
              round: parseInt(roundKey),
              committee_id: batch.batch_header.committee_id,
              block_height: blockHeight,
              timestamp: Number(batch.batch_header.timestamp),
            });
          }
        }

        // Batch's own signature
        if (batch.batch_header.signature) {
          const validatorAddress = getAddressFromSignature(batch.batch_header.signature);
          signatureParticipations.push({
            validator_address: validatorAddress,
            batch_id: batchKey,
            round: parseInt(roundKey),
            committee_id: batch.batch_header.committee_id,
            block_height: blockHeight,
            timestamp: Number(batch.batch_header.timestamp),
           });
        }
      }
    }

    return { committeeMembers, batchInfos, committeeParticipations, signatureParticipations };
  }

  public async startInitialSync(): Promise<void> {
    try {
      await this.syncLatestBlocks();
      syncEvents.emit('initialSyncCompleted');
    } catch (error) {
      logger.error('Error during initial sync:', error);
      throw error;
    }
  }

  public async getLatestSyncedBlockHeight(): Promise<number> {
    const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
    return Math.max(latestSyncedBlock, this.SYNC_START_BLOCK - 1);
  }
}

export default BlockSyncService;