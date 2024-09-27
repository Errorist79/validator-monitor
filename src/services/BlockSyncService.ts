import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { BlockAttributes, APIBlock } from '../database/models/Block.js';
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

  private async syncLatestBlocks(): Promise<void> {
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
      } catch (error) {
        logger.warn(`Attempt ${attempt} failed to sync block range ${startHeight}-${endHeight}:`, error);
        if (attempt < this.MAX_RETRIES) {
          await sleep(this.RETRY_DELAY * attempt);
        } else {
          logger.error(`Failed to sync block range ${startHeight}-${endHeight} after ${this.MAX_RETRIES} attempts`);
        }
      }
    }
  }

  private async syncBlockRange(startHeight: number, endHeight: number): Promise<void> {
    try {
      const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
      if (blocks instanceof Error) {
        throw blocks;
      }
      
      const blockAttributes: BlockAttributes[] = blocks.map(block => this.aleoSDKService.convertToBlockAttributes(block));
      await this.snarkOSDBService.upsertBlocks(blockAttributes);
      
      for (const block of blocks) {
        // Batch ve komite katılımlarını işle
        await this.processBatchesAndParticipation(block);
      }
      
      logger.info(`Synchronized blocks from ${startHeight} to ${endHeight}`);
    } catch (error) {
      logger.error(`Error syncing block range from ${startHeight} to ${endHeight}:`, error);
      throw error;
    }
  }

  private async processBatchesAndParticipation(block: APIBlock): Promise<void> {
    try {
      const firstRound = Object.keys(block.authority.subdag.subdag)[0];
      const batches = block.authority.subdag.subdag[firstRound];
      const blockHeight = parseInt(block.header.metadata.height);

      for (const batch of batches) {
        const author = batch.batch_header.author;
        
        // Stake bilgisini al
        const bondedInfo = await this.aleoSDKService.getBondedMapping(author);
        const selfStake = bondedInfo ? bondedInfo.microcredits : BigInt(0);

        // Committee mapping bilgisini al
        const committeeMapping = await this.aleoSDKService.getCommitteeMapping(author);
        const isOpen = committeeMapping ? committeeMapping.isOpen : false;
        const commission = committeeMapping ? BigInt(committeeMapping.commission) : BigInt(0);

        // Delegated stake bilgisini al
        const totalStake = await this.aleoSDKService.getDelegatedMapping(author);

        // Komite üyesini güncelle veya ekle
        await this.snarkOSDBService.insertOrUpdateCommitteeMember(
          author,
          blockHeight,
          totalStake,
          isOpen,
          commission
        );

        // Batch'i işle
        await this.snarkOSDBService.insertBatch({
          batch_id: batch.batch_header.batch_id,
          author: author,
          round: parseInt(firstRound),
          timestamp: parseInt(batch.batch_header.timestamp),
          committee_id: batch.batch_header.committee_id,
          block_height: blockHeight
        });

        // Komite katılımını kaydet
        await this.snarkOSDBService.insertCommitteeParticipation({
          committee_member_address: author,
          committee_id: batch.batch_header.committee_id,
          round: parseInt(firstRound),
          block_height: blockHeight,
          timestamp: parseInt(batch.batch_header.timestamp)
        });
      }
    } catch (error) {
      logger.error(`Error processing batches and participation for block ${block.block_hash}:`, error);
      throw error;
    }
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

  private getValidatorAddress(apiBlock: APIBlock): string | undefined {
    const firstRound = Object.keys(apiBlock.authority.subdag.subdag)[0];
    if (firstRound && apiBlock.authority.subdag.subdag[firstRound].length > 0) {
      return apiBlock.authority.subdag.subdag[firstRound][0].batch_header.author;
    }
    return undefined;
  }
}

export default BlockSyncService;