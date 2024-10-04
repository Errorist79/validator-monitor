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
  private readonly SYNC_INTERVAL = 5000; // 5 saniye
  private readonly BATCH_SIZE = 50;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 saniye
  private readonly SYNC_START_BLOCK: number;
  private readonly SYNC_THRESHOLD = 10; // Eşik değeri, örneğin 10 blok

  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private cacheService: CacheService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
    initializeWasm(); // WASM başlatma
  }

  async startSyncProcess(): Promise<void> {
    setInterval(async () => {
      try {
        await this.syncLatestBlocks();
      } catch (error) {
        logger.error('Block synchronization failed:', error);
      }
    }, this.SYNC_INTERVAL);
  }

  public async syncLatestBlocks(): Promise<void> {
    const latestSyncedBlock = await this.getLatestSyncedBlockHeight();
    const latestNetworkBlock = await this.aleoSDKService.getLatestBlockHeight();

    if (latestNetworkBlock === null) {
      logger.warn('Unable to fetch latest network block height');
      return;
    }

    if (latestNetworkBlock > latestSyncedBlock) {
      let currentHeight = latestSyncedBlock + 1;
      while (currentHeight <= latestNetworkBlock) {
        const endHeight = Math.min(currentHeight + this.BATCH_SIZE - 1, latestNetworkBlock);
        await this.syncBlockRangeWithRetry(currentHeight, endHeight);
        currentHeight = endHeight + 1;
      }
      logger.info(`Blocks synchronized up to height ${latestNetworkBlock}`);
    } else {
      logger.info('Blocks are already up-to-date');
    }

    // Senkronizasyon durumunu kontrol ediyoruz
    const isSynchronized = await this.isDataSynchronized();

    if (isSynchronized) {
      // Senkronizasyon tamamlandıysa dataSynchronized olayını yayınlıyoruz
      syncEvents.emit('dataSynchronized');
    }

    // 'validatorsUpdated' olayını yayınlıyoruz
    syncEvents.emit('validatorsUpdated');
  }

  public async getLatestSyncedBlockHeight(): Promise<number> {
    const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
    return Math.max(latestSyncedBlock, this.SYNC_START_BLOCK - 1);
  }

  private async syncBlockRangeWithRetry(startHeight: number, endHeight: number): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await this.syncBlockRange(startHeight, endHeight);
        return;
      } catch (error: unknown) {
        if (error instanceof Error) {
          logger.warn(`Attempt ${attempt} failed to sync block range ${startHeight}-${endHeight}: ${error.message}`, { stack: error.stack });
        } else {
          logger.warn(`Attempt ${attempt} failed to sync block range ${startHeight}-${endHeight}: Unknown error`);
        }
        if (attempt === this.MAX_RETRIES) {
          logger.error(`Failed to sync block range ${startHeight}-${endHeight} after ${this.MAX_RETRIES} attempts`);
          throw error;
        }
        await sleep(this.RETRY_DELAY);
      }
    }
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
    committeeMapping: CommitteeMapping;
    bondedMapping: BondedMapping;
    delegatedMapping: DelegatedMapping;
  }> {
    const cacheKey = `mappings_${author}`;
    const cachedData = await this.cacheService.get(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const [committeeMapping, bondedMapping, delegatedMapping] = await Promise.all([
      this.aleoSDKService.getCommitteeMapping(author),
      this.aleoSDKService.getBondedMapping(author),
      this.aleoSDKService.getDelegatedMapping(author)
    ]);
    
    if (!committeeMapping || !bondedMapping || !delegatedMapping) {
      throw new Error(`Failed to retrieve mapping for author ${author}`);
    }
    
    const mappings = { committeeMapping, bondedMapping, delegatedMapping };
    await this.cacheService.set(cacheKey, mappings, 2 * 60 * 60); // 2 saat TTL
    
    return mappings;
  }

  private async processBatchesAndParticipation(block: APIBlock): Promise<void> {
    try {
      const blockHeight = parseInt(block.header.metadata.height);
      logger.debug(`Processing batches and participation for block ${blockHeight}`);

      for (const roundKey in block.authority.subdag.subdag) {
        const batches: APIBatch[] = block.authority.subdag.subdag[roundKey];
        for (const batch of batches) {
          const author = batch.batch_header.author;
          
          const mappings = await this.getMappings(author);

          if (!mappings.committeeMapping || !mappings.bondedMapping) {
            logger.warn(`${author} için eksik eşleme verisi, blok yüksekliği ${blockHeight}`);
            continue;
          }

          const { committeeMapping, bondedMapping, delegatedMapping } = mappings;
          const totalStake = bondedMapping.microcredits + (delegatedMapping ? delegatedMapping.microcredits : BigInt(0));

          await this.snarkOSDBService.insertOrUpdateCommitteeMember(
            author,
            blockHeight,
            totalStake,
            committeeMapping.is_open,
            BigInt(committeeMapping.commission)
          );

          await this.saveBatchInfo(batch, blockHeight, parseInt(roundKey));
           await this.saveCommitteeParticipation(
             author,
             batch.batch_header.committee_id,
             parseInt(roundKey),
             blockHeight,
             Number(batch.batch_header.timestamp)
           );

          // Batch'in kendi imzasını kaydedelim
          const batchSignature = batch.batch_header.signature;
          if (batchSignature) {
            const validatorAddress = getAddressFromSignature(batchSignature);

            await this.snarkOSDBService.insertSignatureParticipation({
              validator_address: validatorAddress,
              batch_id: batch.batch_header.batch_id,
              round: parseInt(roundKey),
              committee_id: batch.batch_header.committee_id,
              block_height: blockHeight,
              timestamp: Number(batch.batch_header.timestamp),
            });
          }

          // Diğer imzaları kaydedelim
          if (batch.signatures) {
            for (const signature of batch.signatures) {
              const validatorAddress = getAddressFromSignature(signature);

              await this.snarkOSDBService.insertSignatureParticipation({
                validator_address: validatorAddress,
                batch_id: batch.batch_header.batch_id,
                round: parseInt(roundKey),
                committee_id: batch.batch_header.committee_id,
                block_height: blockHeight,
                timestamp: Number(batch.batch_header.timestamp),
              });
            }
          }
        }
      }

      logger.info(`${blockHeight} bloğu için toplu işlemler ve katılım işlendi`);
    } catch (error) {
      logger.error(`${block.block_hash} bloğu için toplu işlemler ve katılım işlenirken hata oluştu:`, error);
      throw error;
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
      // Blok verilerini önce işleyin
      const blockAttributes = this.aleoSDKService.convertToBlockAttributes(apiBlock);
      await this.snarkOSDBService.upsertBlock(blockAttributes);

      // Blok işlendikten sonra batch ve committee verilerini işleyin
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
      logger.warn('Unable to fetch latest network block height');
      return false;
    }

    const blockDifference = latestNetworkBlock - latestSyncedBlock;
    if (blockDifference <= this.SYNC_THRESHOLD) {
      logger.info(`Data is considered synchronized. Block difference: ${blockDifference}`);
      return true;
    } else {
      logger.info(`Data is not synchronized. Block difference: ${blockDifference}`);
      return false;
    }
  }

  // getValidatorAddress fonksiyonunu kaldırıyoruz çünkü artık kullanılmıyor
}

export default BlockSyncService;