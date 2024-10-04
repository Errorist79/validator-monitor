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

export class BlockSyncService {
  private static instance: BlockSyncService;
  private cacheService: CacheService;

  private readonly SYNC_INTERVAL = 5000; // 5 saniye
  private readonly BATCH_SIZE = 50;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 saniye
  private readonly SYNC_START_BLOCK: number;

  private static mappingCache: Map<string, {
    committeeMapping: CommitteeMapping | null;
    bondedMapping: BondedMapping | null;
    delegatedMapping: DelegatedMapping | null;
    lastUpdated: number;
  }> = new Map();

  private readonly MAPPING_UPDATE_INTERVAL = 2 * 60 * 60 * 1000; // 2 saat

  private readonly SYNC_THRESHOLD = 10; // Eşik değeri, örneğin 10 blok

  public constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    this.cacheService = new CacheService(2 * 60 * 60, config.redis.url); // 2 saat TTL
    initializeWasm(); // WASM başlatma
  }

  public static getInstance(
    aleoSDKService: AleoSDKService,
    snarkOSDBService: SnarkOSDBService
  ): BlockSyncService {
    if (!BlockSyncService.instance) {
      BlockSyncService.instance = new BlockSyncService(
        aleoSDKService,
        snarkOSDBService
      );
    }
    return BlockSyncService.instance;
  }

  async startSyncProcess(): Promise<void> {
    logger.info('Starting block synchronization process');
    await this.initializeMappings(); // Mapping verilerini başlangıçta yüklüyoruz
    this.updateMappingsPeriodically(); // Mapping güncelleme işlemini başlatıyoruz
    while (true) {
      try {
        await this.syncLatestBlocks();
      } catch (error) {
        logger.error('Block synchronization failed:', error);
        await sleep(this.RETRY_DELAY);
      }
      await sleep(this.SYNC_INTERVAL);
    }
  }

  public async syncLatestBlocks(): Promise<void> {
    try {
      const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
      const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();

      if (latestNetworkBlock === null) {
        logger.warn('Unable to fetch latest network block height');
        return;
      }

      if (latestNetworkBlock > latestSyncedBlock) {
        const batchSize = this.BATCH_SIZE;
        let currentHeight = latestSyncedBlock + 1;
        
        while (currentHeight <= latestNetworkBlock) {
          const endHeight = Math.min(
            currentHeight + batchSize - 1,
            latestNetworkBlock
          );
          
          try {
            const blocks = await this.aleoSDKService.getBlockRange(
              currentHeight,
              endHeight
            );

            // Blokları paralel olarak işlemleyelim
            await Promise.all(blocks.map(block => this.processBlock(block)));

            logger.info(`Synchronized blocks from ${currentHeight} to ${endHeight}`);
            currentHeight = endHeight + 1;
          } catch (error) {
            logger.error(`Error syncing block range ${currentHeight}-${endHeight}:`, error);
            await sleep(this.RETRY_DELAY);
          }
        }
        
        logger.info(`Blocks synchronized up to height ${latestNetworkBlock}`);
        
        // Senkronizasyon olayını tetikleyelim
        syncEvents.emit('dataSynchronized');
        syncEvents.emit('validatorsUpdated');
      } else {
        logger.info('Blocks are already up-to-date');
      }
    } catch (error) {
      logger.error('Error in syncLatestBlocks:', error);
    }
  }

  public async getLatestSyncedBlockHeight(): Promise<number> {
    const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
    return Math.max(latestSyncedBlock, this.SYNC_START_BLOCK - 1);
  }

  private async syncBlockRangeWithRetry(startHeight: number, endHeight: number): Promise<void> {
    let retries = 0;
    while (retries < this.MAX_RETRIES) {
      try {
        logger.debug(`Fetching block range from ${startHeight} to ${endHeight}`);
        const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
        for (const block of blocks) {
          await this.processBlock(block);
        }
        logger.info(`Successfully synced blocks from ${startHeight} to ${endHeight}`);
        return;
      } catch (error) {
        logger.error(`Error syncing block range ${startHeight}-${endHeight}:`, error);
        retries++;
        if (retries < this.MAX_RETRIES) {
          logger.info(`Retrying in ${this.RETRY_DELAY / 1000} seconds...`);
          await sleep(this.RETRY_DELAY);
        }
      }
    }
    throw new Error(`Failed to sync block range ${startHeight}-${endHeight} after ${this.MAX_RETRIES} retries`);
  }

  private async syncBlockRange(startHeight: number, endHeight: number): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 saniye

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
        for (const block of blocks) {
          const blockAttributes = this.aleoSDKService.convertToBlockAttributes(block);
          await this.snarkOSDBService.upsertBlock(blockAttributes);
          await this.processBatchesAndParticipation(block);
        }
        logger.info(`Synchronized blocks from ${startHeight} to ${endHeight}`);
        return;
      } catch (error) {
        logger.warn(`Attempt ${attempt} failed to sync block range ${startHeight}-${endHeight}: ${error}`);
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  private async getMappings(author: string): Promise<{
    committeeMapping: CommitteeMapping | null;
    bondedMapping: BondedMapping | null;
    delegatedMapping: DelegatedMapping | null;
  }> {
    const [committeeMapping, bondedMapping, delegatedMapping] = await Promise.all([
      this.aleoSDKService.getCommitteeMapping(author),
      this.aleoSDKService.getBondedMapping(author),
      this.aleoSDKService.getDelegatedMapping(author)
    ]);
    
    return { committeeMapping, bondedMapping, delegatedMapping };
  }

  private async processBatchesAndParticipation(block: APIBlock): Promise<void> {
    try {
      const blockHeight = parseInt(block.header.metadata.height);
      logger.debug(`Processing batches and participation for block ${blockHeight}`);

      const batchPromises = [];

      for (const roundKey in block.authority.subdag.subdag) {
        const batches: APIBatch[] = block.authority.subdag.subdag[roundKey];

        for (const batch of batches) {
          batchPromises.push(this.processSingleBatch(batch, blockHeight, parseInt(roundKey)));
        }
      }

      // Tüm batch işlemlerini paralel olarak çalıştırıyoruz
      await Promise.all(batchPromises);

      logger.info(`Processed batches and participation for block ${blockHeight}`);
    } catch (error) {
      logger.error(`Error processing batches and participation for block ${block.header.metadata.height}:`, error);
      throw error;
    }
  }

  private async processSingleBatch(batch: APIBatch, blockHeight: number, roundKey: number): Promise<void> {
    const author = batch.batch_header.author;

    // Mapping verilerini önbellekten alıyoruz
    let cachedMappings = BlockSyncService.mappingCache.get(author);

    // Eğer önbellekte yoksa veya güncellenmesi gerekiyorsa, yeniden yüklüyoruz
    if (!cachedMappings || (Date.now() - cachedMappings.lastUpdated) > this.MAPPING_UPDATE_INTERVAL) {
      const newMappings = await this.loadMappingsForAddress(author);
      BlockSyncService.mappingCache.set(author, {
        ...newMappings,
        lastUpdated: Date.now()
      });
      cachedMappings = BlockSyncService.mappingCache.get(author);
    }

    if (!cachedMappings?.committeeMapping || !cachedMappings?.bondedMapping) {
      logger.warn(`Incomplete mapping data for ${author}, skipping batch processing`);
      return; // Bu batch'i atla ve işlemeye devam et
    }

    const totalStake =
      cachedMappings.bondedMapping.microcredits +
      (cachedMappings.delegatedMapping ? cachedMappings.delegatedMapping.microcredits : BigInt(0));

    await this.snarkOSDBService.insertOrUpdateCommitteeMember(
      author,
      blockHeight,
      totalStake,
      cachedMappings.committeeMapping.is_open,
      BigInt(cachedMappings.committeeMapping.commission)
    );

    await this.saveBatchInfo(batch, blockHeight, roundKey);
    await this.saveCommitteeParticipation(
      author,
      batch.batch_header.committee_id,
      roundKey,
      blockHeight,
      Number(batch.batch_header.timestamp)
    );

    // Signature participations
    const signatureParticipations = [];

    // Save batch's own signature
    const batchSignature = batch.batch_header.signature;
    if (batchSignature) {
      const validatorAddress = getAddressFromSignature(batchSignature);
      signatureParticipations.push({
        validator_address: validatorAddress,
        batch_id: batch.batch_header.batch_id,
        round: roundKey,
        committee_id: batch.batch_header.committee_id,
        block_height: blockHeight,
        timestamp: Number(batch.batch_header.timestamp),
      });
    }

    // Save other signatures
    if (batch.signatures) {
      for (const signature of batch.signatures) {
        const validatorAddress = getAddressFromSignature(signature);
        signatureParticipations.push({
          validator_address: validatorAddress,
          batch_id: batch.batch_header.batch_id,
          round: roundKey,
          committee_id: batch.batch_header.committee_id,
          block_height: blockHeight,
          timestamp: Number(batch.batch_header.timestamp),
        });
      }
    }

    // Batch insert signature participations
    if (signatureParticipations.length > 0) {
      await this.snarkOSDBService.insertSignatureParticipations(signatureParticipations);
    }
  }

  private async saveBatchInfo(batch: any, blockHeight: number, round: number): Promise<void> {
    await this.snarkOSDBService.insertBatch({
      batch_id: batch.batch_header.batch_id,
      author: batch.batch_header.author,
      round: round, // parseInt(batch.batch_header.round) yerine round parametresini kullanıyoruz
      timestamp: parseInt(batch.batch_header.timestamp),
      committee_id: batch.batch_header.committee_id,
      block_height: blockHeight
    });
  }


  private async saveCommitteeParticipation(
    author: string, 
    committeeId: string, 
    round: number, 
    blockHeight: number,
    timestamp: number // timestamp parametresini ekledik
  ): Promise<void> {
    await this.snarkOSDBService.insertCommitteeParticipation({
      validator_address: author,
      committee_id: committeeId,
      round: round,
      block_height: blockHeight,
      timestamp: timestamp // batch.batch_header.timestamp yerine direkt parametreyi kullanıyoruz
    });
  }

  private async processBlock(apiBlock: APIBlock): Promise<void> {
    try {
      const blockAttributes = this.aleoSDKService.convertToBlockAttributes(apiBlock);
      await this.snarkOSDBService.upsertBlock(blockAttributes);
      await this.processBatchesAndParticipation(apiBlock);
    } catch (error) {
      logger.error(`Error processing block at height ${apiBlock.header.metadata.height}:`, error);
      throw error;
    }
  }

  private extractBatchesFromBlock(apiBlock: APIBlock): BatchAttributes[] {
    const batches: BatchAttributes[] = [];
    for (const roundKey in apiBlock.authority.subdag.subdag) {
      const roundBatches = apiBlock.authority.subdag.subdag[roundKey];
      for (const batch of roundBatches) {
        batches.push({
          batch_id: batch.batch_header.batch_id,
          author: batch.batch_header.author,
          round: parseInt(roundKey),
          timestamp: Number(batch.batch_header.timestamp),
          committee_id: batch.batch_header.committee_id,
          block_height: parseInt(apiBlock.header.metadata.height)
        });
      }
    }
    return batches;
  }

  public async isDataSynchronized(): Promise<boolean> {
    const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
    const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();

    if (latestNetworkBlock === null) {
      logger.warn('En son ağ blok yüksekliği alınamadı');
      return false;
    }

    const blockDifference = latestNetworkBlock - latestSyncedBlock;
    const isSynchronized = blockDifference <= this.SYNC_THRESHOLD;
    
    logger.info(`Senkronizasyon durumu: ${isSynchronized ? 'Senkronize' : 'Senkronize değil'}. Blok farkı: ${blockDifference}`);
    
    return isSynchronized;
  }

  // getValidatorAddress fonksiyonunu kaldırıyoruz çünkü artık kullanılmıyor

  public async initializeMappings(): Promise<void> {
    logger.info('Loading initial mappings...');
    const validators = await this.snarkOSDBService.getAllValidatorAddresses();
    for (const address of validators) {
      const mappings = await this.loadMappingsForAddress(address);
      BlockSyncService.mappingCache.set(address, {
        ...mappings,
        lastUpdated: Date.now()
      });
    }
    logger.info('Initial mappings loaded.');
  }

  private async loadMappingsForAddress(address: string): Promise<{
    committeeMapping: CommitteeMapping | null;
    bondedMapping: BondedMapping | null;
    delegatedMapping: DelegatedMapping | null;
  }> {
    const cacheKey = `mappings:${address}`;
    const cachedMappings = await this.cacheService.get<{
      committeeMapping: CommitteeMapping | null;
      bondedMapping: BondedMapping | null;
      delegatedMapping: DelegatedMapping | null;
    }>(cacheKey);

    if (cachedMappings) {
      logger.debug(`Cache hit for mappings of ${address}`);
      return cachedMappings;
    }

    const [committeeMapping, bondedMapping, delegatedMapping] = await Promise.all([
      this.aleoSDKService.getCommitteeMapping(address),
      this.aleoSDKService.getBondedMapping(address),
      this.aleoSDKService.getDelegatedMapping(address)
    ]);

    const mappings = { committeeMapping, bondedMapping, delegatedMapping };
    await this.cacheService.set(cacheKey, mappings);
    return mappings;
  }

  private updateMappingsPeriodically(): void {
    setInterval(async () => {
      logger.debug('Updating mappings periodically.');
      const validators = await this.snarkOSDBService.getAllValidatorAddresses();
      for (const address of validators) {
        try {
          await this.loadMappingsForAddress(address);
        } catch (error) {
          logger.error(`Periyodik mapping güncelleme sırasında hata oluştu (${address}):`, error);
        }
      }
    }, this.MAPPING_UPDATE_INTERVAL);
  }
}

export default BlockSyncService;