import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { APIBlock, APIBatch } from '../database/models/Block.js';
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
    const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
    const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();

    if (latestNetworkBlock === null) {
      logger.warn('En son ağ blok yüksekliği alınamadı');
      return;
    }

    if (latestNetworkBlock > latestSyncedBlock) {
      await this.syncBlockRange(latestSyncedBlock + 1, latestNetworkBlock);
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
  }

  public async getLatestSyncedBlockHeight(): Promise<number> {
    const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
    return Math.max(latestSyncedBlock, this.SYNC_START_BLOCK - 1);
  }

  private async syncBlockRange(startHeight: number, endHeight: number): Promise<void> {
    const batchSize = this.currentBatchSize;
    for (let currentHeight = startHeight; currentHeight <= endHeight; currentHeight += batchSize) {
      const batchEndHeight = Math.min(currentHeight + batchSize - 1, endHeight);
      await this.syncBlockRangeWithRetry(currentHeight, batchEndHeight);
      this.processingQueue.push({ startHeight: currentHeight, endHeight: batchEndHeight });
      this.processQueue();
    }
  }

  private async syncBlockRangeWithRetry(startHeight: number, endHeight: number, maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const batchSize = 30; // Daha küçük bir batch boyutu kullanıyoruz
        for (let batchStart = startHeight; batchStart <= endHeight; batchStart += batchSize) {
          const batchEnd = Math.min(batchStart + batchSize - 1, endHeight);
          const blocks = await this.aleoSDKService.getBlockRange(batchStart, batchEnd);
          await this.processBlocks(blocks);
          await sleep(1000); // Her batch arasında 1 saniye bekliyoruz
        }
        return; // Başarılı olursa döngüden çık
      } catch (error) {
        logger.warn(`Deneme ${attempt} başarısız oldu, blok aralığı ${startHeight}-${endHeight}: ${error}`);
        if (attempt === maxRetries) {
          throw error; // Son denemede de başarısız olursa hatayı fırlat
        }
        await sleep(5000 * attempt); // Her denemede artan bekleme süresi
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
    const blockAttributesList = [];
    const committeeMembers = [];
    const batchInfos = [];
    const committeeParticipations = [];
    const signatureParticipations = [];

    for (const block of blocks) {
      const blockAttributes = this.aleoSDKService.convertToBlockAttributes(block);
      blockAttributesList.push(blockAttributes);

      const extractedData = await this.extractBatchAndParticipationData(block);
      committeeMembers.push(...extractedData.committeeMembers);
      batchInfos.push(...extractedData.batchInfos);
      committeeParticipations.push(...extractedData.committeeParticipations);
      signatureParticipations.push(...extractedData.signatureParticipations);
    }

    return { blockAttributesList, committeeMembers, batchInfos, committeeParticipations, signatureParticipations };
  }

  private async bulkInsertData(processedData: {
    blockAttributesList: any[];
    committeeMembers: any[];
    batchInfos: any[];
    committeeParticipations: any[];
    signatureParticipations: any[];
  }): Promise<void> {
    await Promise.all([
      this.snarkOSDBService.upsertBlocks(processedData.blockAttributesList),
      this.snarkOSDBService.bulkInsertCommitteeMembers(processedData.committeeMembers),
      this.snarkOSDBService.bulkInsertBatchInfos(processedData.batchInfos),
      this.snarkOSDBService.bulkInsertCommitteeParticipations(processedData.committeeParticipations),
      this.snarkOSDBService.bulkInsertSignatureParticipations(processedData.signatureParticipations)
    ]);
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
      mappings = await this.aleoSDKService.getMappings(author);
      await this.cacheService.set(cacheKey, mappings, 3600); // 1 saat önbellekleme
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

  private adjustBatchSize(duration: number): void {
    const targetDuration = 5000; // 5 saniye
    if (duration < targetDuration) {
      this.currentBatchSize = Math.min(this.currentBatchSize * 2, 200); // Maksimum 1000
    } else if (duration > targetDuration * 2) {
      this.currentBatchSize = Math.max(Math.floor(this.currentBatchSize / 2), 10); // Minimum 10
    }
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

        // Batch Infos
        batchInfos.push({
          batch_id: batchKey,
          author,
          block_height: blockHeight,
          round: parseInt(roundKey),
          timestamp: Number(batch.batch_header.timestamp),
          committee_id: batch.batch_header.committee_id || 'unknown'
        });

        try {
          const mappings = await this.getMappings(author);

          if (!mappings.committeeMapping || !mappings.bondedMapping) {
            logger.warn(`Missing mapping data for ${author} at block height ${blockHeight}`);
            continue;
          }

          const { committeeMapping, bondedMapping, delegatedMapping } = mappings;
          const totalStake = bondedMapping.microcredits + (delegatedMapping ? delegatedMapping.microcredits : BigInt(0));

          // Committee Members
          committeeMembers.push({
            address: author,
            first_seen_block: blockHeight,
            last_seen_block: blockHeight,
            total_stake: totalStake.toString(),
            is_open: committeeMapping.is_open,
            commission: BigInt(committeeMapping.commission).toString(),
            is_active: true,
            block_height: blockHeight
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
        } catch (error) {
          logger.error(`Error processing batch for author ${author}:`, error);
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
}

export default BlockSyncService;