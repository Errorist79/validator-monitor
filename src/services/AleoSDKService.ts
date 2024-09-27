import { AleoNetworkClient } from '@provablehq/sdk';
import winston from 'winston';
import axios from 'axios';
import { BlockAttributes, APIBlock } from '../types/Block.js';
import { validateBlock } from '../utils/validation.js';
import { AppError, ValidationError, NotFoundError } from '../utils/errors.js';
import { metrics } from '../utils/metrics.js';
import { getBigIntFromString } from '../utils/helpers.js';

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

  async getLatestBlock(): Promise<BlockAttributes | null> {
    try {
      logger.debug('Fetching the latest block');
      const rawLatestBlock = await this.network.getLatestBlock();
      if (!rawLatestBlock) {
        throw new NotFoundError('No block found');
      }
      if (rawLatestBlock instanceof Error) {
        throw rawLatestBlock;
      }
      const apiBlock = this.convertToAPIBlock(rawLatestBlock);
      const convertedBlock = this.convertToBlockAttributes(apiBlock);
      logger.debug('Converted latest block:', JSON.stringify(convertedBlock, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));
      
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

  public convertToBlockAttributes(apiBlock: APIBlock): BlockAttributes {
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: parseInt(apiBlock.header.metadata.timestamp),
      transactions_count: apiBlock.transactions.length
    };
  }

  async getLatestCommittee(): Promise<{ starting_round: string; members: Record<string, [string, boolean, string]> }> {
    try {
      const response = await this.network.getLatestCommittee();
      if (typeof response !== 'object' || response === null || !('starting_round' in response) || !('members' in response)) {
        throw new Error('Invalid committee response structure');
      }
      return response as { starting_round: string; members: Record<string, [string, boolean, string]> };
    } catch (error) {
      logger.error('Error fetching latest committee:', error);
      throw error;
    }
  }

  async getValidatorStake(address: string): Promise<bigint | null> {
    try {
      const bondedInfo = await this.getBondedMapping(address);
      return bondedInfo ? bondedInfo.microcredits : null;
    } catch (error) {
      logger.error(`Error fetching validator stake for ${address}:`, error);
      return null;
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
        microcredits: getBigIntFromString(parsedResult.microcredits.replace('u64', ''))
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
      return getBigIntFromString((result as string).replace('u64', ''));
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

  async getBlockByHeight(height: number): Promise<APIBlock | null> {
    try {
      const rawBlock = await this.network.getBlock(height);
      if (!rawBlock) {
        return null;
      }
      if (rawBlock instanceof Error) {
        throw rawBlock;
      }
      return this.convertToAPIBlock(rawBlock);
    } catch (error) {
      logger.error(`Error fetching block at height ${height}:`, error);
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

  private convertToAPIBlock(rawBlock: any): APIBlock {
    return {
      block_hash: rawBlock.block_hash,
      previous_hash: rawBlock.previous_hash,
      header: {
        previous_state_root: rawBlock.header.previous_state_root,
        transactions_root: rawBlock.header.transactions_root,
        finalize_root: rawBlock.header.finalize_root,
        ratifications_root: rawBlock.header.ratifications_root,
        solutions_root: rawBlock.header.solutions_root,
        subdag_root: rawBlock.header.subdag_root,
        metadata: {
          network: rawBlock.header.metadata.network,
          round: rawBlock.header.metadata.round,
          height: rawBlock.header.metadata.height,
          cumulative_weight: rawBlock.header.metadata.cumulative_weight,
          cumulative_proof_target: rawBlock.header.metadata.cumulative_proof_target,
          coinbase_target: rawBlock.header.metadata.coinbase_target,
          proof_target: rawBlock.header.metadata.proof_target,
          last_coinbase_target: rawBlock.header.metadata.last_coinbase_target,
          last_coinbase_timestamp: rawBlock.header.metadata.last_coinbase_timestamp,
          timestamp: rawBlock.header.metadata.timestamp
        }
      },
      authority: rawBlock.authority,
      ratifications: rawBlock.ratifications,
      solutions: rawBlock.solutions,
      transactions: rawBlock.transactions,
      aborted_transaction_ids: rawBlock.aborted_transaction_ids
    };
  }

  async getBlockRange(startHeight: number, endHeight: number): Promise<APIBlock[]> {
    try {
      logger.debug(`Fetching block range from ${startHeight} to ${endHeight}`);
      const blocks = await this.network.getBlockRange(startHeight, endHeight);
      if (blocks instanceof Error) {
        throw blocks;
      }
      return blocks.map(this.convertToAPIBlock);
    } catch (error) {
      logger.error(`Error fetching block range from ${startHeight} to ${endHeight}:`, error);
      throw new Error(`Failed to get block range from ${startHeight} to ${endHeight}`);
    }
  }
}

export default AleoSDKService;