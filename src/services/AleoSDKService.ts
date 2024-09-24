import { AleoNetworkClient } from '@provablehq/sdk';
import winston from 'winston';
import axios from 'axios';
import { Block, APIBlock } from '../types/Block.js';
import { validateBlock } from '../utils/validation.js';
import { AppError, ValidationError, NotFoundError } from '../utils/errors.js';
import { metrics } from '../utils/metrics.js';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

export class AleoSDKService {
  private network: AleoNetworkClient;

  constructor(networkUrl: string, networkType: 'mainnet' | 'testnet') {
    this.network = new AleoNetworkClient(networkUrl);
    logger.info(`AleoSDKService initialized with ${networkType} at ${networkUrl}`);
  }

  async getLatestBlock(): Promise<Block | null> {
    try {
      logger.debug('Fetching the latest block');
      const latestBlock = await this.network.getLatestBlock();
      
      if (!latestBlock) {
        throw new NotFoundError('No block found');
      }

      if (latestBlock instanceof Error) {
        throw latestBlock;
      }

      const convertedBlock = this.convertApiBlockToBlock(latestBlock);
      logger.debug('Converted latest block:', JSON.stringify(convertedBlock, null, 2));
      
      const { error } = validateBlock(convertedBlock);
      if (error) {
        throw new ValidationError(`Invalid block structure: ${error.message}`);
      }
      
      logger.debug('Latest block fetched and validated', { blockHeight: convertedBlock.height });
      metrics.incrementBlocksProcessed();
      return convertedBlock;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Error fetching latest block', { error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  }

  private convertApiBlockToBlock(apiBlock: any): Block {
    if (!apiBlock) {
      throw new Error('Invalid block structure');
    }
    
    logger.debug('API Block:', JSON.stringify(apiBlock, null, 2));
    
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      timestamp: apiBlock.header?.metadata?.timestamp ? new Date(Number(apiBlock.header.metadata.timestamp) * 1000).toISOString() : undefined,
      transactions: apiBlock.transactions || [],
      validator_address: apiBlock.authority?.subdag?.subdag?.[Object.keys(apiBlock.authority.subdag.subdag)[0]]?.[0]?.batch_header?.author,
      total_fees: apiBlock.header?.metadata?.cumulative_weight 
        ? BigInt(apiBlock.header.metadata.cumulative_weight)
        : undefined,
      transactions_count: apiBlock.transactions?.length || 0,
      header: {
        metadata: {
          height: apiBlock.header.metadata.height,
          timestamp: apiBlock.header.metadata.timestamp,
          round: apiBlock.header.metadata.round
        }
      },
      authority: apiBlock.authority,
      block_hash: apiBlock.block_hash,
      ratifications: apiBlock.ratifications || [],
      solutions: apiBlock.solutions || { version: 1 },
      aborted_solution_ids: apiBlock.aborted_solution_ids || [],
      aborted_transaction_ids: apiBlock.aborted_transaction_ids || []
    };
  }

  async getLatestCommittee(): Promise<{
    id: string;
    starting_round: number;
    members: Record<string, [number, boolean, number]>;
    total_stake: number;
  }> {
    try {
      const committeeInfo = await this.network.getLatestCommittee();
      if (typeof committeeInfo === 'object' && committeeInfo !== null &&
          'id' in committeeInfo &&
          'starting_round' in committeeInfo &&
          'members' in committeeInfo &&
          'total_stake' in committeeInfo) {
        return committeeInfo as {
          id: string;
          starting_round: number;
          members: Record<string, [number, boolean, number]>;
          total_stake: number;
        };
      } else {
        throw new Error('Invalid committee info structure');
      }
    } catch (error) {
      logger.error('Error fetching latest committee:', error);
      throw error;
    }
  }

  async getCommitteeMapping(address: string): Promise<{ isOpen: boolean; commission: number } | null> {
    try {
      const result = await this.network.getProgramMappingValue("credits.aleo", "committee", address);
      if (!result) {
        return null;
      }
      const parsedResult = JSON.parse(result as string);
      return {
        isOpen: parsedResult.is_open,
        commission: parseInt(parsedResult.commission.replace('u8', ''))
      };
    } catch (error) {
      logger.error(`Error fetching committee mapping for ${address}:`, error);
      throw error;
    }
  }

  async getBondedMapping(address: string): Promise<{ validator: string; microcredits: bigint } | null> {
    try {
      const result = await this.network.getProgramMappingValue("credits.aleo", "bonded", address);
      if (!result) {
        return null;
      }
      const parsedResult = JSON.parse(result as string);
      return {
        validator: parsedResult.validator,
        microcredits: BigInt(parsedResult.microcredits.replace('u64', ''))
      };
    } catch (error) {
      logger.error(`Error fetching bonded mapping for ${address}:`, error);
      throw error;
    }
  }

  async getDelegatedMapping(address: string): Promise<bigint> {
    try {
      const result = await this.network.getProgramMappingValue("credits.aleo", "delegated", address);
      if (!result) {
        return BigInt(0);
      }
      return BigInt((result as string).replace('u64', ''));
    } catch (error) {
      logger.error(`Error fetching delegated mapping for ${address}:`, error);
      throw error;
    }
  }

  async getTotalNetworkStake(): Promise<bigint> {
    try {
      const committee = await this.getLatestCommittee();
      let totalStake = BigInt(0);
      for (const address of Object.keys(committee)) {
        const delegated = await this.getDelegatedMapping(address);
        totalStake += delegated;
      }
      return totalStake;
    } catch (error) {
      logger.error('Error calculating total network stake:', error);
      throw error;
    }
  }

  async getTransactionsInMempool(): Promise<any[]> {
    try {
      const transactions = await this.network.getTransactionsInMempool();
      if (transactions instanceof Error) {
        throw transactions;
      }
      metrics.setTransactionsInMempool(transactions.length);
      return transactions;
    } catch (error) {
      logger.error('getTransactionsInMempool error:', error);
      throw error;
    }
  }
  async getBlock(height: number): Promise<any> {
    try {
      logger.debug(`Fetching block at height ${height}...`);
      const block = await this.network.getBlock(height);
      logger.debug(`Raw API response: ${JSON.stringify(block)}`);
      return block;
    } catch (error) {
      logger.error(`Error while fetching block at height ${height}:`, error);
      throw new Error(`Failed to get block at height ${height}`);
    }
  }

  async getTransaction(id: string) {
    try {
      logger.debug(`Fetching transaction with id ${id}...`);
      const transaction = await this.network.getTransaction(id);
      logger.debug(`Raw API response: ${JSON.stringify(transaction)}`);
      return transaction;
    } catch (error) {
      logger.error(`Error while fetching transaction with id ${id}:`, error);
      throw new Error(`Failed to get transaction with id ${id}`);
    }
  }

  async getTransactions(height: number) {
    try {
      logger.debug(`Fetching transactions for block height ${height}...`);
      const transactions = await this.network.getTransactions(height);
      logger.debug(`Raw API response: ${JSON.stringify(transactions)}`);
      return transactions;
    } catch (error) {
      logger.error(`Error while fetching transactions for block height ${height}:`, error);
      throw new Error(`Failed to get transactions for block height ${height}`);
    }
  }

  async getBlockByHeight(height: number): Promise<Block | null> {
    try {
      const apiBlock = await this.network.getBlock(height);
      if (apiBlock instanceof Error) {
        logger.error(`Error fetching block at height ${height}:`, apiBlock);
        return null;
      }
      return this.convertApiBlockToBlock(apiBlock);
    } catch (error) {
      logger.error(`Error while fetching block at height ${height}:`, error);
      return null;
    }
  }

  async getLatestBlockHeight(): Promise<number | null> {
    try {
      const latestHeight = await this.network.getLatestHeight();
      if (typeof latestHeight === 'number') {
        return latestHeight;
      } else {
        logger.warn('Unexpected response format:', latestHeight);
        return null;
      }
    } catch (error) {
      this.handleAxiosError(error);
      throw error;
    }
  }
  async getBlockRange(start: number, end: number): Promise<Block[]> {
    try {
      logger.debug(`Fetching block range from ${start} to ${end}...`);
      const apiBlocks = await this.network.getBlockRange(start, end);
      
      if (!Array.isArray(apiBlocks)) {
        logger.warn('Unexpected response format for block range');
        return [];
      }

      const blocks: Block[] = apiBlocks.map(apiBlock => this.convertApiBlockToBlock(apiBlock));
      
      logger.debug(`Successfully fetched ${blocks.length} blocks`);
      return blocks;
    } catch (error) {
      logger.error(`Error while fetching block range from ${start} to ${end}:`, error);
      throw new Error(`Failed to get block range from ${start} to ${end}`);
    }
  }


  async getRawLatestBlock(): Promise<any> {
    try {
      const latestBlock = await this.network.getLatestBlock();
      logger.debug('Raw latest block:', JSON.stringify(latestBlock, null, 2));
      return latestBlock;
    } catch (error) {
      logger.error('getRawLatestBlock error:', error);
      throw error;
    }
  }

  private handleAxiosError(error: any): void {
    if (axios.isAxiosError(error)) {
      logger.error('Axios error', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
    } else {
      logger.error('Unknown error', { error: error.message });
    }
  }
}

export default AleoSDKService;