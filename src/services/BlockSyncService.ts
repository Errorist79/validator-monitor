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
  private currentBatchSize = 50; // Başlangıç değeri

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

        const blockAttributesList = [];
        const committeeMembers = [];
        const batchInfos = [];
        const committeeParticipations = [];
        const signatureParticipations = [];

        for (const block of blocks) {
          const blockAttributes = this.aleoSDKService.convertToBlockAttributes(block);
          blockAttributesList.push(blockAttributes);

          // Batches ve katılımlar için verileri topluyoruz
          const { 
            committeeMembers: cm, 
            batchInfos: bi, 
            committeeParticipations: cp, 
            signatureParticipations: sp 
          } = await this.extractBatchAndParticipationData(block);

          committeeMembers.push(...cm);
          batchInfos.push(...bi);
          committeeParticipations.push(...cp);
          signatureParticipations.push(...sp);
        }

        // Veritabanı işlemlerini toplu olarak yapıyoruz
        await Promise.all([
          this.snarkOSDBService.upsertBlocks(blockAttributesList),
          this.snarkOSDBService.bulkInsertCommitteeMembers(committeeMembers),
          this.snarkOSDBService.bulkInsertBatchInfos(batchInfos),
          this.snarkOSDBService.bulkInsertCommitteeParticipations(committeeParticipations),
          this.snarkOSDBService.bulkInsertSignatureParticipations(signatureParticipations)
        ]);

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

  private async processBatchesAndParticipation(block: APIBlock): Promise<void> {
    try {
      const blockHeight = parseInt(block.header.metadata.height);
      logger.debug(`Processing batches and participation for block ${blockHeight}`);

      const committeeMembers = [];
      const batchInfosMap = new Map<string, any>();
      const committeeParticipationsMap = new Map<string, any>();
      const signatureParticipationsMap = new Map<string, any>();

      for (const roundKey in block.authority.subdag.subdag) {
        const batches = block.authority.subdag.subdag[roundKey];
        for (const batch of batches) {
          const batchKey = batch.batch_header.batch_id;
          const author = batch.batch_header.author;

          // Batch Infos
          if (!batchInfosMap.has(batchKey)) {
            batchInfosMap.set(batchKey, {
              batch_id: batchKey,
              author,
              block_height: blockHeight,
              round: parseInt(roundKey),
              timestamp: Number(batch.batch_header.timestamp),
              committee_id: batch.batch_header.committee_id || 'unknown' // Eğer committee_id yoksa 'unknown' kullan
            });
          }

          try {
            const mappings = await this.getMappings(author);

            if (!mappings.committeeMapping || !mappings.bondedMapping) {
              logger.warn(`${author} için eksik eşleme verisi, blok yüksekliği ${blockHeight}`);
              continue;
            }

            const { committeeMapping, bondedMapping, delegatedMapping } = mappings;
            const totalStake = bondedMapping.microcredits + (delegatedMapping ? delegatedMapping.microcredits : BigInt(0));

            // Verileri dizilere ekliyoruz
            committeeMembers.push({
              address: author,
              first_seen_block: blockHeight, // Validator'ın ilk görüldüğü blok
              last_seen_block: blockHeight,  // Validator'ın son görüldüğü blok
              total_stake: totalStake.toString(),
              is_open: committeeMapping.is_open,
              commission: BigInt(committeeMapping.commission).toString(),
              is_active: true,               // Varsayılan olarak aktif kabul edilebilir
              block_height: blockHeight      // Mevcut blok yüksekliği
            });

            // Committee Participations
            const committeeKey = `${author}_${roundKey}`;
            if (!committeeParticipationsMap.has(committeeKey)) {
              committeeParticipationsMap.set(committeeKey, {
                validator_address: author,
                committee_id: batch.batch_header.committee_id,
                round: parseInt(roundKey),
                block_height: blockHeight,
                timestamp: Number(batch.batch_header.timestamp)
              });
            }

            // Signature Participations
            if (batch.signatures) {
              for (const signature of batch.signatures) {
                const validatorAddress = getAddressFromSignature(signature);
                const signatureKey = `${validatorAddress}_${batchKey}`;
                if (!signatureParticipationsMap.has(signatureKey)) {
                  signatureParticipationsMap.set(signatureKey, {
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

            // Batch'in kendi imzası
            if (batch.batch_header.signature) {
              const validatorAddress = getAddressFromSignature(batch.batch_header.signature);
              const signatureKey = `${validatorAddress}_${batchKey}`;
              if (!signatureParticipationsMap.has(signatureKey)) {
                signatureParticipationsMap.set(signatureKey, {
                  validator_address: validatorAddress,
                  batch_id: batchKey,
                  round: parseInt(roundKey),
                  committee_id: batch.batch_header.committee_id,
                  block_height: blockHeight,
                  timestamp: Number(batch.batch_header.timestamp),
                });
              }
            }
          } catch (error) {
            logger.error(`Error processing batch for author ${batch.batch_header.author}:`, error);
          }
        }
      }

      // Map'leri dizilere dönüştürüyoruz
      const batchInfos = Array.from(batchInfosMap.values());
      const committeeParticipations = Array.from(committeeParticipationsMap.values());
      const signatureParticipations = Array.from(signatureParticipationsMap.values());

      // Toplu veritabanı işlemlerini gerçekleştiriyoruz
      await Promise.all([
        this.snarkOSDBService.bulkInsertCommitteeMembers(committeeMembers),
        this.snarkOSDBService.bulkInsertBatchInfos(batchInfos),
        this.snarkOSDBService.bulkInsertCommitteeParticipations(committeeParticipations),
        this.snarkOSDBService.bulkInsertSignatureParticipations(signatureParticipations)
      ]);

      logger.debug(`${blockHeight} bloğu için batch ve katılım işlemleri tamamlandı`);
    } catch (error) {
      logger.error(`${block.block_hash} bloğu için batch ve katılım işlenirken hata oluştu:`, error);
      throw error;
    }
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

  private adjustBatchSize(duration: number): void {
    const targetDuration = 5000; // 5 saniye
    if (duration < targetDuration) {
      this.currentBatchSize = Math.min(this.currentBatchSize * 2, 1000); // Maksimum 1000
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
}

export default BlockSyncService;