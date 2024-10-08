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

export class BlockSyncService {
  private readonly SYNC_INTERVAL = 5000; // 5 saniye
  private readonly BATCH_SIZE = 50;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 saniye
  private readonly SYNC_START_BLOCK: number;
  private readonly SYNC_THRESHOLD = 10; // Eşik değeri, örneğin 10 blok
  private currentBatchSize = 50; // Başlangıç değeri
  private isSyncing: boolean = false;
  private isFullySynchronized: boolean = false;
  private lastSyncedBlockHeight: number = 0;

  private processingQueue: Array<{ startHeight: number; endHeight: number }> = [];
  private isProcessing: boolean = false;

  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private cacheService: CacheService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    initializeWasm(); // WASM başlatma
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
        throw new Error('En son ağ blok yüksekliği alınamadı');
      }

      const startHeight = Math.max(await this.getLatestSyncedBlockHeight(), this.SYNC_START_BLOCK);
      const endHeight = latestNetworkBlock;

      const batchSize = 50; // Daha büyük batch boyutu
      const concurrency = 5; // Eşzamanlı işlem sayısı

      const tasks = [];
      for (let height = startHeight; height <= endHeight; height += batchSize) {
        const batchEndHeight = Math.min(height + batchSize - 1, endHeight);
        tasks.push(() => this.syncBlockRangeWithRetry(height, batchEndHeight));
      }

      const limit = pLimit(concurrency);
      await Promise.all(tasks.map(task => limit(task)));

      this.isFullySynchronized = true;
      syncEvents.emit('initialSyncCompleted');
    } catch (error) {
      logger.error('Initial synchronization failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private startRegularSync(): void {
    const adaptiveSync = async () => {
      if (this.isSyncing) return;
      this.isSyncing = true;
      try {
        const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();
        if (latestNetworkBlock === null) {
          throw new Error('En son ağ blok yüksekliği alınamadı');
        }

        const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
        if (latestNetworkBlock > latestSyncedBlock) {
          await this.syncBlockRange(latestSyncedBlock + 1, latestNetworkBlock);
          this.lastSyncedBlockHeight = latestNetworkBlock;
          logger.info(`Bloklar ${latestNetworkBlock} yüksekliğine kadar senkronize edildi`);
        }

        if (this.isFullySynchronized) {
          syncEvents.emit('regularSyncCompleted');
        }
      } catch (error) {
        logger.error('Regular synchronization failed:', error);
      } finally {
        this.isSyncing = false;
      }

      const nextSyncDelay = this.calculateNextSyncDelay();
      setTimeout(adaptiveSync, nextSyncDelay);
    };

    adaptiveSync();
  }

  private calculateNextSyncDelay(): number {
    // Burada ağ durumuna göre adaptif bir gecikme hesaplayabilirsiniz
    return this.SYNC_INTERVAL;
  }

  public async syncLatestBlocks(): Promise<void> {
    try {
      const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();
      if (latestNetworkBlock === null) {
        logger.warn('En son ağ blok yüksekliği alınamadı');
        return;
      }

      let startHeight = await this.getLatestSyncedBlockHeight();
      
      if (latestNetworkBlock > startHeight) {
        await this.syncBlockRange(startHeight + 1, latestNetworkBlock);
        logger.info(`Bloklar ${latestNetworkBlock} yüksekliğine kadar senkronize edildi`);
      } else {
        logger.info('Bloklar zaten güncel');
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
    const batchSize = this.currentBatchSize;
    for (let currentHeight = startHeight; currentHeight <= endHeight; currentHeight += batchSize) {
      const batchEndHeight = Math.min(currentHeight + batchSize - 1, endHeight);
      await this.syncBlockRangeWithRetry(currentHeight, batchEndHeight);
      this.processingQueue.push({ startHeight: currentHeight, endHeight: batchEndHeight });
      await this.processQueue();
    }
  }

  private async syncBlockRangeWithRetry(startHeight: number, endHeight: number, maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
        const processedData = await this.processBlocks(blocks);
        await this.bulkInsertData(processedData);
        logger.info(`${startHeight} ile ${endHeight} arasındaki bloklar senkronize edildi`);
        return;
      } catch (error) {
        logger.warn(`Deneme ${attempt} başarısız oldu, blok aralığı ${startHeight}-${endHeight}: ${error}`);
        if (attempt === maxRetries) {
          throw error;
        }
        await sleep(5000 * attempt);
      }
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
    
    logger.info(`${startHeight} ile ${endHeight} arasındaki bloklar işlendi`);
    
    // Blok aralığı işlendiğinde bir olay yayınla
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
    const client = await this.snarkOSDBService.getClient();
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
      logger.error('bulkInsertData işleminde hata:', error);
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
      logger.warn('En son ağ blok yüksekliği alınamadı');
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

        // Batch'in kendi imzası
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