import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { ValidatorService } from './ValidatorService.js';
import logger from '../utils/logger.js';
import { BlockAttributes, APIBlock } from '../database/models/Block.js';

/* export class SyncService {
  constructor(
    private aleoSDKService: AleoSDKService, 
    private snarkOSDBService: SnarkOSDBService,
    private validatorService: ValidatorService
  ) {}

  async syncLatestBlocks(count: number = 100): Promise<void> {
    const batchSize = 10;
    const retryAttempts = 3;
    let currentHeight = await this.snarkOSDBService.getLatestBlockHeight();
    const latestNetworkHeight = await this.aleoSDKService.getLatestBlockHeight();

    if (latestNetworkHeight === null) {
      logger.error('Failed to get latest network height');
      return;
    }

    while (currentHeight < latestNetworkHeight && count > 0) {
      const endHeight = Math.min(currentHeight + batchSize, latestNetworkHeight, currentHeight + count);
      
      for (let attempt = 0; attempt < retryAttempts; attempt++) {
        try {
          const blocks = await this.fetchBlockRange(currentHeight + 1, endHeight);
          await this.snarkOSDBService.upsertBlocks(blocks);
          break;
        } catch (error) {
          if (attempt === retryAttempts - 1) {
            logger.error(`Failed to sync blocks from ${currentHeight + 1} to ${endHeight} after ${retryAttempts} attempts`);
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      
      currentHeight = endHeight;
      count -= (endHeight - currentHeight);
    }
  }

  private async processBlock(apiBlock: APIBlock, height: number): Promise<void> {
    try {
      const blockAttributes: BlockAttributes = {
        height: height,
        hash: apiBlock.block_hash,
        previous_hash: apiBlock.previous_hash,
        round: parseInt(apiBlock.header.metadata.round),
        timestamp: parseInt(apiBlock.header.metadata.timestamp),
        validator_address: this.getValidatorAddress(apiBlock),
        total_fees: BigInt(apiBlock.header.metadata.cumulative_weight),
        transactions_count: apiBlock.transactions ? apiBlock.transactions.length : 0
      };

      await this.snarkOSDBService.upsertBlock(blockAttributes);
      await this.processBatches(apiBlock, height);
    } catch (error) {
      logger.error(`Error processing block at height ${height}:`, error);
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

  private async processBatches(apiBlock: APIBlock, blockHeight: number): Promise<void> {
    const firstRound = Object.keys(apiBlock.authority.subdag.subdag)[0];
    const batches = apiBlock.authority.subdag.subdag[firstRound];

    for (const batch of batches) {
      await this.processBatch(batch, parseInt(firstRound), blockHeight);
    }
  }

  private async processBatch(batch: any, round: number, blockHeight: number): Promise<void> {
    try {
      await this.snarkOSDBService.insertBatch({
        batch_id: batch.batch_header.batch_id,
        author: batch.batch_header.author,
        round: round,
        timestamp: batch.batch_header.timestamp,
        committee_id: batch.batch_header.committee_id,
        block_height: blockHeight
      });

      await this.snarkOSDBService.insertOrUpdateCommitteeMember(batch.batch_header.author, blockHeight);

      await this.snarkOSDBService.insertCommitteeParticipation({
        committee_member_address: batch.batch_header.author,
        committee_id: batch.batch_header.committee_id,
        round: round,
        block_height: blockHeight,
        timestamp: batch.batch_header.timestamp
      });
    } catch (error) {
      logger.error(`Error processing batch ${batch.batch_header.batch_id}:`, error);
      throw error;
    }
  }

  private async fetchBlockRange(startHeight: number, endHeight: number): Promise<BlockAttributes[]> {
    const blocks: BlockAttributes[] = [];
    for (let height = startHeight; height <= endHeight; height++) {
      const apiBlock = await this.aleoSDKService.getBlockByHeight(height);
      if (apiBlock) {
        blocks.push(this.aleoSDKService.convertToBlockAttributes(apiBlock));
      } else {
        logger.warn(`Block not found at height ${height}`);
      }
    }
    return blocks;
  }
} */