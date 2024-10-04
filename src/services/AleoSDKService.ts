import { AleoNetworkClient } from '@provablehq/sdk';
import winston from 'winston';
import axios from 'axios';
import { BlockAttributes, APIBlock } from '../database/models/Block.js';
import { validateBlock } from '../utils/validation.js';
import { AppError, ValidationError, NotFoundError } from '../utils/errors.js';
import { metrics } from '../utils/metrics.js';
import { getBigIntFromString } from '../utils/helpers.js';
import { BondedMapping, CommitteeMapping, LatestCommittee, DelegatedMapping } from '../database/models/Mapping.js';
import logger from '../utils/logger.js';
import { CacheService } from './CacheService.js';
import { config } from '../config/index.js';

// Özel tip tanımlamaları
type CommitteeResult = {
  is_open: boolean;
  commission: string | number;
};

type BondedResult = {
  validator: string;
  microcredits: string | number;
};

export class AleoSDKService {
  private static instance: AleoSDKService;
  private cacheService: CacheService;

  private constructor(
    private readonly sdkUrl: string,
    private readonly networkType: 'mainnet' | 'testnet'
  ) {
    this.network = new AleoNetworkClient(sdkUrl);
    this.cacheService = new CacheService(2 * 60 * 60, config.redis.url); // 2 saat TTL
    logger.info(`AleoSDKService initialized with ${networkType} at ${sdkUrl}`);
  }

  public static getInstance(
    sdkUrl: string,
    networkType: 'mainnet' | 'testnet'
  ): AleoSDKService {
    if (!AleoSDKService.instance) {
      AleoSDKService.instance = new AleoSDKService(sdkUrl, networkType);
    }
    return AleoSDKService.instance;
  }

  private network: AleoNetworkClient;

  private committeeMappingCache: Map<string, CommitteeMapping> = new Map();
  private bondedMappingCache: Map<string, BondedMapping> = new Map();
  private delegatedMappingCache: Map<string, DelegatedMapping> = new Map();
  private readonly MAPPING_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 saat
  private mappingCacheTimestamps: Map<string, number> = new Map();

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
        logger.error('Block validation error:', error);
        logger.error('Invalid block:', JSON.stringify(convertedBlock, null, 2));
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

  async getCurrentRound(): Promise<bigint> {
    try {
      logger.debug('Fetching current round');
      const latestBlock = await this.getLatestBlock();
      if (!latestBlock) {
        throw new Error('Unable to fetch latest block');
      }
      const currentRound = BigInt(latestBlock.round);
      logger.debug(`Current round fetched: ${currentRound}`);
      return currentRound;
    } catch (error) {
      logger.error('Error fetching current round:', error);
      throw error;
    }
  }

  async getLatestCommittee(): Promise<LatestCommittee> {
    try {
      const result = await this.network.getLatestCommittee();
      if (this.isValidLatestCommittee(result)) {
        return result;
      }
      throw new Error('Invalid committee data structure');
    } catch (error) {
      logger.error('Error fetching latest committee:', error);
      throw error;
    }
  }

  private isValidLatestCommittee(data: any): data is LatestCommittee {
    return (
      typeof data === 'object' &&
      data !== null &&
      'id' in data &&
      'starting_round' in data &&
      'members' in data &&
      'total_stake' in data
    );
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

  async getCommitteeMapping(address: string): Promise<CommitteeMapping | null> {
    const cacheKey = `committee_mapping:${address}`;
    const cachedMapping = await this.cacheService.get<CommitteeMapping>(cacheKey);

    if (cachedMapping) {
      logger.debug(`Cache hit for committee mapping of ${address}`);
      return cachedMapping;
    }

    try {
      const rawResult = await this.network.getProgramMappingValue("credits.aleo", "committee", address);
      logger.debug(`Raw committee mapping result for ${address}:`, rawResult);

      const result = this.parseRawResult(rawResult);
      logger.debug(`Parsed committee mapping result for ${address}:`, result);

      if (result && typeof result === 'object') {
        const isOpen = result.is_open === true || result.is_open === 'true';
        const commissionValue = result.commission || '0';
        const commission = Number(commissionValue.toString().replace(/\D/g, ''));

        const mapping: CommitteeMapping = {
          is_open: isOpen,
          commission: commission
        };

        await this.cacheService.set(cacheKey, mapping);
        return mapping;
      }

      logger.warn(`No committee mapping found or invalid format for address ${address}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching committee mapping for ${address}:`, error);
      return null;
    }
  }

  async getBondedMapping(address: string): Promise<BondedMapping | null> {
    const cacheKey = `bonded_mapping:${address}`;
    const cachedMapping = await this.cacheService.get<BondedMapping>(cacheKey);

    if (cachedMapping) {
      logger.debug(`Cache hit for bonded mapping of ${address}`);
      return cachedMapping;
    }

    try {
      const rawResult = await this.network.getProgramMappingValue("credits.aleo", "bonded", address);
      logger.debug(`Raw bonded mapping result for ${address}:`, rawResult);

      const result = this.parseRawResult(rawResult);
      logger.debug(`Parsed bonded mapping result for ${address}:`, result);

      if (result && typeof result === 'object') {
        const microcreditsValue = result.microcredits || '0';
        const microcredits = BigInt(microcreditsValue.toString().replace(/\D/g, ''));

        const mapping: BondedMapping = {
          validator: result.validator || address,
          microcredits: microcredits
        };

        await this.cacheService.set(cacheKey, mapping);
        return mapping;
      }

      logger.warn(`No bonded mapping found or invalid format for address ${address}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching bonded mapping for ${address}:`, error);
      return null;
    }
  }

  async getDelegatedMapping(address: string): Promise<DelegatedMapping | null> {
    const cacheKey = `delegated_mapping:${address}`;
    const cachedMapping = await this.cacheService.get<DelegatedMapping>(cacheKey);

    if (cachedMapping) {
      logger.debug(`Cache hit for delegated mapping of ${address}`);
      return cachedMapping;
    }

    try {
      const rawResult = await this.network.getProgramMappingValue("credits.aleo", "delegated", address);
      logger.debug(`Raw delegated mapping result for ${address}:`, rawResult);

      const result = this.parseRawResult(rawResult);
      logger.debug(`Parsed delegated mapping result for ${address}:`, result);

      if (result && typeof result === 'object') {
        const microcreditsValue = result.microcredits || '0';
        const microcredits = BigInt(microcreditsValue.toString().replace(/\D/g, ''));

        const mapping: DelegatedMapping = {
          delegator: result.delegator || address,
          microcredits: microcredits
        };

        await this.cacheService.set(cacheKey, mapping);
        return mapping;
      }

      logger.warn(`No delegated mapping found or invalid format for address ${address}`);
      return null;
    } catch (error) {
      logger.error(`Error fetching delegated mapping for ${address}:`, error);
      return null;
    }
  }

  private parseRawResult(rawResult: any): any {
    if (typeof rawResult === 'object' && rawResult !== null) {
      // Gelen veri zaten bir nesne ise, doğrudan döndür
      return rawResult;
    }

    if (typeof rawResult === 'string') {
      try {
        // Veriyi doğrudan JSON.parse ile ayrıştırmayı deneyin
        const parsedResult = JSON.parse(rawResult);
        return parsedResult;
      } catch {
        // Ayrıştırma başarısız olursa, regex ile temizlemeyi deneyin
        try {
          let cleanedResult = rawResult;

          // Anahtar isimlerini çift tırnak içine al
          cleanedResult = cleanedResult.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

          // Dize değerlerini çift tırnak içine al
          cleanedResult = cleanedResult.replace(/:\s*([a-zA-Z0-9_]+)([,}])/g, ': "$1"$2');

          // Sayısal değerlerdeki tip eklerini kaldır
          cleanedResult = cleanedResult.replace(/(\d+)u(16|32|64|128)/g, '$1');

          const parsedResult = JSON.parse(cleanedResult);
          return parsedResult;
        } catch (error) {
          logger.error('Error parsing raw result with regex:', error);
          logger.error('Raw result:', rawResult);
          return null;
        }
      }
    }

    logger.error('Unsupported raw result format:', rawResult);
    return null;
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
      // logger.debug(`Raw API response: ${JSON.stringify(block)}`);
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
      height: rawBlock.header.metadata.height,
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
          timestamp: Number(rawBlock.header.metadata.timestamp)
        }
      },
      authority: rawBlock.authority,
      ratifications: rawBlock.ratifications,
      solutions: rawBlock.solutions,
      transactions: rawBlock.transactions,
      aborted_transaction_ids: rawBlock.aborted_transaction_ids
    };
  }

  public convertToBlockAttributes(apiBlock: APIBlock): BlockAttributes {
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: Number(apiBlock.header.metadata.timestamp), // Unix timestamp'i number olarak bırakıyoruz
      transactions_count: apiBlock.transactions.length,
      block_reward: apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount ? Number(apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount) : undefined
    };
  }

  async getBlockRange(startHeight: number, endHeight: number): Promise<APIBlock[]> {
    try {
      logger.debug(`Fetching block range from ${startHeight} to ${endHeight}`);
      const blocks = await this.network.getBlockRange(startHeight, endHeight);

      if (!blocks || blocks instanceof Error) {
        throw new Error('Failed to fetch block range');
      }

      // Convert raw blocks to APIBlock format
      const apiBlocks = blocks.map((block: any) => {
        if (block) {
          return this.convertToAPIBlock(block);
        } else {
          logger.warn('Received undefined block in block range');
          return null;
        }
      }).filter((block): block is APIBlock => block !== null);

      return apiBlocks;
    } catch (error) {
      logger.error(`Error fetching block range from ${startHeight} to ${endHeight}:`, error);
      throw new Error(`Failed to get block range from ${startHeight} to ${endHeight}`);
    }
  }
}

export default AleoSDKService;