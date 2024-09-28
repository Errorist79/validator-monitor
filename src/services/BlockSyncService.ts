import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { APIBlock } from '../database/models/Block.js';
import { BatchAttributes } from '../database/models/Batch.js';
import { sleep } from '../utils/helpers.js';
import { config } from '../config/index.js';

export class BlockSyncService {
  private readonly SYNC_INTERVAL = 5000; // 5 saniye
  private readonly BATCH_SIZE = 50;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 3000; // 3 saniye
  private readonly SYNC_START_BLOCK: number;

  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {
    this.SYNC_START_BLOCK = config.sync.startBlock;
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
    }
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

  private async processBatchesAndParticipation(block: APIBlock): Promise<void> {
    try {
      for (const roundKey in block.authority.subdag.subdag) {
        const batches = block.authority.subdag.subdag[roundKey];
        for (const batch of batches) {
          const author = batch.batch_header.author;
          const blockHeight = parseInt(block.header.metadata.height);
          
          logger.debug(`Processing batch for author ${author} at block ${blockHeight}`);
  
          const committeeMapping = await this.aleoSDKService.getCommitteeMapping(author);
          const bondedMapping = await this.aleoSDKService.getBondedMapping(author);
          const delegatedMapping = await this.aleoSDKService.getDelegatedMapping(author);
  
          logger.debug(`Mappings for author ${author}:`, {
            committeeMapping,
            bondedMapping,
            delegatedMapping
          });
  
          if (!committeeMapping || !bondedMapping) {
            logger.warn(`Missing mapping data for author ${author} at block ${blockHeight}`);
            continue;
          }
  
          const totalStake = bondedMapping.microcredits + (delegatedMapping ? delegatedMapping.microcredits : BigInt(0));
  
          logger.debug(`Inserting or updating committee member ${author}`, {
            blockHeight,
            totalStake: totalStake.toString(),
            isOpen: committeeMapping.is_open,
            commission: committeeMapping.commission
          });
  
          await this.snarkOSDBService.insertOrUpdateCommitteeMember(
            author,
            blockHeight,
            totalStake,
            committeeMapping.is_open,
            BigInt(committeeMapping.commission)
          );
  
          await this.saveBatchInfo(batch, blockHeight);
          await this.saveCommitteeParticipation(author, batch.batch_header.committee_id, parseInt(roundKey), blockHeight);
        }
      }
      logger.info(`Processed batches and participation for block ${block.block_hash}`);
    } catch (error) {
      logger.error(`Error processing batches and participation for block ${block.block_hash}:`, error);
      throw error;
    }
  }

  private async saveBatchInfo(batch: any, blockHeight: number): Promise<void> {
    await this.snarkOSDBService.insertBatch({
      batch_id: batch.batch_header.batch_id,
      author: batch.batch_header.author,
      round: parseInt(batch.batch_header.round),
      timestamp: parseInt(batch.batch_header.timestamp),
      committee_id: batch.batch_header.committee_id,
      block_height: blockHeight
    });
  }

  private async saveCommitteeParticipation(author: string, committeeId: string, round: number, blockHeight: number): Promise<void> {
    await this.snarkOSDBService.insertCommitteeParticipation({
      committee_member_address: author,
      committee_id: committeeId,
      round: round,
      block_height: blockHeight,
      timestamp: Date.now()
    });
  }

  private async processBlock(apiBlock: APIBlock): Promise<void> {
    try {
      const blockAttributes = this.aleoSDKService.convertToBlockAttributes(apiBlock);
      await this.snarkOSDBService.upsertBlock(blockAttributes);

      const batches = this.extractBatchesFromBlock(apiBlock);
      for (const batch of batches) {
        await this.snarkOSDBService.insertBatch(batch);
      }
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

  // getValidatorAddress fonksiyonunu kaldırıyoruz çünkü artık kullanılmıyor
}

export default BlockSyncService;