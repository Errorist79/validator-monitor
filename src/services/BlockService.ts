import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';
import { Block } from '../types/Block.js';

export class BlockService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService
  ) {}

  async syncBlocks(batchSize: number = 10): Promise<void> {
    try {
      const latestSyncedBlock = await this.snarkOSDBService.getLatestBlockHeight();
      const latestNetworkBlock = await this.getLatestBlock();
      
      console.log("Latest synchronized block:", latestSyncedBlock);
      console.log("Latest block in the network:", latestNetworkBlock);
      
      // ... existing synchronization logic ...
    } catch (error) {
      console.error('Error occurred during block synchronization:', error);
    }
  }

  private async fetchBlockRange(startHeight: number, endHeight: number): Promise<Block[]> {
    const blocks: Block[] = [];
    for (let height = startHeight; height <= endHeight; height++) {
      try {
        const block = await this.aleoSDKService.getBlockByHeight(height);
        if (block) {
          blocks.push(block);
        } else {
          logger.warn(`Block not retrieved: ${height}`);
        }
      } catch (error) {
        logger.error(`Error occurred while fetching block at height ${height}:`, error);
      }
    }
    return blocks;
  }

  async getLatestBlock() {
    try {
      const latestHeight = await this.aleoSDKService.getLatestBlockHeight();
      if (latestHeight === null) {
        throw new Error('Failed to get the latest block height');
      }
      return this.aleoSDKService.getBlockByHeight(latestHeight);
    } catch (error) {
      logger.error('Error occurred while fetching the latest block:', error);
      throw error;
    }
  }

  public async getBlockByHeight(height: number) {
    return this.aleoSDKService.getBlockByHeight(height);
  }
}

export default BlockService;
