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
      console.log("Latest block in the network:", latestNetworkBlock?.height);
      
      if (latestNetworkBlock && latestSyncedBlock < latestNetworkBlock.height) {
        const startHeight = latestSyncedBlock + 1;
        const endHeight = Math.min(startHeight + batchSize - 1, latestNetworkBlock.height);
        
        const blocks = await this.fetchBlockRange(startHeight, endHeight);
        
        for (const block of blocks) {
          await this.processNewBlock(block);
        }
        
        console.log(`Synchronized blocks from ${startHeight} to ${endHeight}`);
      } else {
        console.log("No new blocks to synchronize");
      }
    } catch (error) {
      console.error('Error occurred during block synchronization:', error);
    }
  }

  private async fetchBlockRange(startHeight: number, endHeight: number): Promise<Block[]> {
    try {
      const blocks = await this.aleoSDKService.getBlockRange(startHeight, endHeight);
      return blocks;
    } catch (error) {
      logger.error(`Blok aralığı ${startHeight}-${endHeight} alınırken hata oluştu:`, error);
      return [];
    }
  }

  async getLatestBlock(): Promise<Block | null> {
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

  public async getBlockByHeight(height: number): Promise<Block | null> {
    return this.aleoSDKService.getBlockByHeight(height);
  }

  async processNewBlock(blockData: Block): Promise<void> {
    try {
      logger.debug(`Processing new block at height: ${blockData.height}`);
      logger.debug(`Full block data: ${JSON.stringify(blockData, null, 2)}`);
      
      // Blok verisini veritabanına kaydet
      await this.snarkOSDBService.insertBlock(blockData);

      // Komite katılım verilerini işle
      if (blockData.authority && blockData.authority.subdag && blockData.authority.subdag.subdag) {
        logger.debug(`Block has committee data. Authority structure: ${JSON.stringify(blockData.authority, null, 2)}`);
        await this.snarkOSDBService.parseCommitteeParticipation(blockData);
      } else {
        logger.warn(`Block ${blockData.height} does not have expected committee data structure`);
      }

      // Validator istatistiklerini güncelle
      if (blockData.validator_address) {
        await this.snarkOSDBService.updateValidatorBlockProduction(
          blockData.validator_address,
          typeof blockData.total_fees === 'string' ? BigInt(blockData.total_fees) : (blockData.total_fees || BigInt(0))
        );
      }

      logger.info(`Successfully processed block at height: ${blockData.height}`);
    } catch (error) {
      logger.error('Error in processNewBlock:', error);
      throw error;
    }
  }
}

export default BlockService;
