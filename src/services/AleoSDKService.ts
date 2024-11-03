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

// Custom type definitions
type CommitteeResult = {
  is_open: boolean;
  commission: string | number;
};

type BondedResult = {
  validator: string;
  microcredits: string | number;
};

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

  async getLatestRound(): Promise<bigint> {
    try {
      logger.debug('Fetching the latest block');
      const latestBlock = await this.getLatestBlock();
      if (!latestBlock) {
        throw new Error('Unable to fetch latest block');
      }
      const latestRound = BigInt(latestBlock.round);
      logger.debug(`Latest round fetched: ${latestRound}`);
      return latestRound;
    } catch (error) {
      logger.error('Error fetching latest round:', error);
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
    try {
      const rawResult = await this.network.getProgramMappingValue("credits.aleo", "committee", address);
      logger.debug(`Raw committee mapping result for ${address}:`, rawResult);

      const result = this.parseRawResult(rawResult);
      if (!result) return null;

      // Commission değerinin doğru parse edildiğinden emin ol
      if (typeof result.commission !== 'number' || result.commission === null) {
        logger.error(`Invalid commission value for ${address}:`, result);
        return null;
      }

      return {
        is_open: Boolean(result.is_open),
        commission: Number(result.commission)
      };
    } catch (error) {
      logger.error(`Error getting committee mapping for ${address}:`, error);
      return null;
    }
  }

  async getDelegatedMapping(address: string): Promise<DelegatedMapping | null> {
    try {
      const result = await this.network.getProgramMappingValue("credits.aleo", "delegated", address);
      logger.debug(`Raw delegated mapping result for ${address}:`, result);

      if (typeof result === 'string') {
        const microcreditsStr = this.cleanNumericValue(result);
        return {
          delegator: address,
          microcredits: BigInt(microcreditsStr) // string'i BigInt'e çevir
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error getting delegated mapping for ${address}:`, error);
      return null;
    }
  }

  async getBondedMapping(address: string): Promise<BondedMapping | null> {
    try {
      const rawResult = await this.network.getProgramMappingValue("credits.aleo", "bonded", address);
      const result = this.parseRawResult(rawResult);
      logger.debug(`Raw bonded mapping result for ${address}:`, result);

      if (!result) return null;

      const microcreditsStr = this.cleanNumericValue(result.microcredits);
      return {
        validator: result.validator || address,
        microcredits: BigInt(microcreditsStr) // string'i BigInt'e çevir
      };
    } catch (error) {
      logger.error(`Error getting bonded mapping for ${address}:`, error);
      return null;
    }
  }

  private cleanNumericValue(value: string | number | bigint): string {
    const strValue = value.toString();
    // Suffix'leri temizle (u64, n, vb.)
    return strValue.replace(/[a-zA-Z]+\d*$/, '');
  }

  private parseRawResult(rawResult: any): any {
    if (typeof rawResult !== 'string') {
      return rawResult;
    }

    try {
      // Eğer sadece sayı + suffix formatındaysa (delegated mapping için)
      if (/^\d+u\d+$/.test(rawResult.trim())) {
        return rawResult.replace(/u\d+$/, '');
      }

      // JSON benzeri string için
      let cleanedResult = rawResult
        // Yeni satır karakterlerini temizle
        .replace(/\\n/g, '')
        .trim();

      // Key'leri quote içine al
      cleanedResult = cleanedResult.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

      // Değerleri işle
      cleanedResult = cleanedResult.replace(/:[\s]*([^,}\s]+)/g, (match, value) => {
        // Boolean değerler
        if (value === 'true' || value === 'false') {
          return `: ${value}`;
        }
        // Commission değeri (u8 suffix'li)
        if (/^\d+u8$/.test(value)) {
          return `: ${value.replace('u8', '')}`;
        }
        // Diğer sayısal değerler (u64 suffix'li)
        if (/^\d+u64$/.test(value)) {
          return `: "${value.replace('u64', '')}"`;
        }
        // Aleo adresleri
        if (value.startsWith('aleo1')) {
          return `: "${value}"`;
        }
        return `: "${value}"`;
      });

      logger.debug('Cleaned result before parsing:', cleanedResult);
      return JSON.parse(cleanedResult);
    } catch (error) {
      logger.error('Error parsing raw result:', error);
      logger.error('Raw result:', rawResult);
      return null;
    }
  }

/*   private parseCommission(commission: any): number | null {
    if (typeof commission === 'number') {
      return commission;
    }
    logger.warn(`Unexpected commission format:`, commission);
    return null;
  }
  
  private parseMicrocredits(microcredits: any): bigint | null {
    if (typeof microcredits === 'number') {
      return BigInt(microcredits);
    }
    if (typeof microcredits === 'string') {
      return BigInt(microcredits);
    }
    logger.warn(`Unexpected microcredits format:`, microcredits);
    return null;
  } */

  async getTotalNetworkStake(): Promise<bigint> {
    try {
      const committee = await this.getLatestCommittee();
      return BigInt(committee.total_stake);
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

  async getLatestBlockHeight(): Promise<number> {
    try {
      const latestBlock = await this.getLatestBlock();
      if (!latestBlock) {
        throw new Error('Unable to fetch latest block');
      }
      return latestBlock.height;
    } catch (error) {
      logger.error('Error fetching latest block height:', error);
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

  private convertToAPIBlock(rawBlock: any): APIBlock {
    const apiBlock = {
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
    return apiBlock;
  }

  public convertToBlockAttributes(apiBlock: APIBlock): BlockAttributes {
    const blockAttributes = {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: Number(apiBlock.header.metadata.timestamp),
      transactions_count: apiBlock.transactions.length,
      block_reward: apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount ? Number(apiBlock.ratifications.find(r => r.type === 'block_reward')?.amount) : undefined
    };
    return blockAttributes;
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

  async getMappings(address: string): Promise<{
    committeeMapping: CommitteeMapping | null;
    bondedMapping: BondedMapping | null;
    delegatedMapping: DelegatedMapping | null;
  }> {
    try {
      const [committeeMapping, bondedMapping, delegatedMapping] = await Promise.all([
        this.getCommitteeMapping(address),
        this.getBondedMapping(address),
        this.getDelegatedMapping(address)
      ]);

      // Null check ve güvenli dönüşümler
      return {
        committeeMapping: committeeMapping ? {
          is_open: Boolean(committeeMapping.is_open),
          commission: Number(committeeMapping.commission)
        } : null,
        bondedMapping: bondedMapping ? {
          validator: bondedMapping.validator,
          microcredits: BigInt(bondedMapping.microcredits) // string'i BigInt'e çevir
        } : null,
        delegatedMapping: delegatedMapping ? {
          delegator: delegatedMapping.delegator,
          microcredits: BigInt(delegatedMapping.microcredits) // string'i BigInt'e çevir
        } : null
      };
    } catch (error) {
      logger.error(`Error getting mappings for ${address}:`, error);
      return {
        committeeMapping: null,
        bondedMapping: null,
        delegatedMapping: null
      };
    }
  }
}

export default AleoSDKService;
