import AleoSDKService from './AleoSDKService.js';
import logger from '../utils/logger.js';

class ConsensusService {
    constructor(private aleoSDKService: AleoSDKService) {}

    async testConnection(): Promise<void> {
        try {
            const latestHeight = await this.aleoSDKService.getLatestBlockHeight();
            if (latestHeight) {
                logger.info(`Connection test successful. Latest block height: ${latestHeight}`);
            } else {
                throw new Error('Block height could not be retrieved');
            }
        } catch (error) {
            logger.error('Error during connection test:', error);
            if (error instanceof Error) {
                throw new Error(`Could not connect to Aleo network: ${error.message}`);
            } else {
                throw new Error('Could not connect to Aleo network: An unknown error occurred');
            }
        }
    }

    async getCurrentRound(): Promise<number | null> {
        try {
          const latestBlock = await this.aleoSDKService.getLatestBlock();
          if (!latestBlock) {
            logger.warn('Could not get the latest block');
            return null;
          }
          logger.debug('Latest block:', JSON.stringify(latestBlock, (_, v) => typeof v === 'bigint' ? v.toString() : v));
          if (typeof latestBlock.height !== 'number' || isNaN(latestBlock.height)) {
            logger.warn(`Invalid block height: ${latestBlock.height}`);
            return null;
          }
          
          const blocksPerRound = 100; // Default value, adjust according to your project
          return Math.floor(latestBlock.height / blocksPerRound);
        } catch (error) {
          logger.error("getCurrentRound error:", error);
          return null;
        }
      }

    async getCommittee(): Promise<any> {
        try {
            return await this.aleoSDKService.getLatestCommittee();
        } catch (error) {
            logger.error('getCommittee error:', error);
            throw new Error('Failed to get committee: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
}
export default ConsensusService;
