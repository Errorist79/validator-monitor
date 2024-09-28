import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { Block, APIBlock, BlockAttributes } from '../database/models/Block.js';

export class BlockService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {}

  async syncBlocks(batchSize: number = 10): Promise<void> {
    try {
      const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
      const latestNetworkBlock = await this.getLatestNetworkBlockHeight();
      
      logger.info(`Latest synchronized block: ${latestSyncedBlock}`);
      logger.info(`Latest block in the network: ${latestNetworkBlock}`);
      
      if (latestNetworkBlock > latestSyncedBlock) {
        let currentHeight = latestSyncedBlock + 1;
        while (currentHeight <= latestNetworkBlock) {
          const endHeight = Math.min(currentHeight + batchSize - 1, latestNetworkBlock);
          logger.info(`Syncing blocks from ${currentHeight} to ${endHeight}`);
          
          const blocks = await this.fetchBlockRange(currentHeight, endHeight);
          await this.snarkOSDBService.upsertBlocks(blocks);
          
          currentHeight = endHeight + 1;
        }
        logger.info('Block synchronization completed successfully');
      } else {
        logger.info('No new blocks to synchronize');
      }
    } catch (error) {
      logger.error('Error occurred during block synchronization:', error);
      throw error;
    }
  }

  private async fetchBlockRange(startHeight: number, endHeight: number): Promise<BlockAttributes[]> {
    const blocks: BlockAttributes[] = [];
    for (let height = startHeight; height <= endHeight; height++) {
      try {
        const apiBlock = await this.aleoSDKService.getBlockByHeight(height);
        if (apiBlock) {
          const blockAttributes = this.convertToBlockAttributes(apiBlock);
          blocks.push(blockAttributes);
        } else {
          logger.warn(`Block not retrieved: ${height}`);
        }
      } catch (error) {
        logger.error(`Error occurred while fetching block at height ${height}:`, error);
      }
    }
    return blocks;
  }

  async getLatestNetworkBlockHeight(): Promise<number> {
    try {
      const latestBlock = await this.aleoSDKService.getLatestBlock();
      return latestBlock ? latestBlock.height : 0;
    } catch (error) {
      logger.error('Error occurred while fetching the latest network block height:', error);
      throw error;
    }
  }

  private convertToBlockAttributes(apiBlock: APIBlock): BlockAttributes {
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: Number(apiBlock.header.metadata.timestamp),
      transactions_count: apiBlock.transactions.length,
      block_reward: apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount ? Number(apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount) : 0
    };
  }

  private getValidatorAddress(apiBlock: APIBlock): string | undefined {
    const firstRound = Object.keys(apiBlock.authority.subdag.subdag)[0];
    if (firstRound && apiBlock.authority.subdag.subdag[firstRound].length > 0) {
      return apiBlock.authority.subdag.subdag[firstRound][0].batch_header.author;
    }
    return undefined;
  }
}

export default BlockService;
