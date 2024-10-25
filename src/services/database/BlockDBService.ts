import { BaseDBService } from './BaseDBService.js';
import { BlockAttributes } from '../../database/models/Block.js';
import format from 'pg-format';
import logger from '../../utils/logger.js';
import { PoolClient } from 'pg';

export class BlockDBService extends BaseDBService {
  async upsertBlocks(blocks: BlockAttributes[], client?: PoolClient): Promise<void> {
    const useProvidedClient = !!client;
    const queryClient = useProvidedClient ? client : await this.getClient();

    try {
      if (!useProvidedClient) await queryClient.query('BEGIN');

      const values = blocks.map(b => [
        b.height,
        b.hash,
        b.previous_hash,
        b.round,
        b.timestamp,
        b.transactions_count,
        b.block_reward !== undefined ? b.block_reward.toString() : null
      ]);

      const query = format(`
        INSERT INTO blocks (height, hash, previous_hash, round, timestamp, transactions_count, block_reward)
        VALUES %L
        ON CONFLICT (height) DO UPDATE SET
          hash = EXCLUDED.hash,
          previous_hash = EXCLUDED.previous_hash,
          round = EXCLUDED.round,
          timestamp = EXCLUDED.timestamp,
          transactions_count = EXCLUDED.transactions_count,
          block_reward = EXCLUDED.block_reward
      `, values);

      await queryClient.query(query);

      if (!useProvidedClient) await queryClient.query('COMMIT');
    } catch (error) {
      if (!useProvidedClient) await queryClient.query('ROLLBACK');
      logger.error(`Error upserting blocks: ${error}`);
      throw error;
    } finally {
      if (!useProvidedClient) queryClient.release();
    }
  }

  async getLatestBlockHeight(): Promise<number> {
    const result = await this.query('SELECT MAX(height) as max_height FROM blocks');
    return result.rows[0].max_height || 0;
  }

  async getBlocksByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    const query = `
      SELECT * FROM blocks 
      WHERE validator_address = $1 
      AND timestamp > NOW() - INTERVAL '1 second' * $2 
      ORDER BY height DESC
    `;
    const result = await this.query(query, [validatorAddress, timeFrame]);
    return result.rows;
  }
  
  async getBlocksInTimeRange(startTime: number, endTime: number): Promise<Array<{ height: number, timestamp: number }>> {
    const query = `
      SELECT height, timestamp
      FROM blocks
      WHERE timestamp >= $1 AND timestamp <= $2
      ORDER BY height ASC
    `;
    
    try {
      const result = await this.query(query, [startTime, endTime]);
      logger.debug(`Retrieved ${result.rows.length} blocks from ${startTime} to ${endTime}`);
      return result.rows.map(row => ({
        height: parseInt(row.height),
        timestamp: parseInt(row.timestamp)
      }));
    } catch (error) {
      logger.error(`Error retrieving blocks in time range: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  async getLatestProcessedBlockHeight(): Promise<number> {
    const result = await this.query('SELECT MAX(height) as max_height FROM blocks');
    return result.rows[0].max_height || 0;
  }

  async upsertBlock(block: BlockAttributes): Promise<void> {
    const query = `
      INSERT INTO blocks (height, hash, previous_hash, round, timestamp, transactions_count, block_reward)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (height) DO UPDATE SET
      hash = EXCLUDED.hash,
      previous_hash = EXCLUDED.previous_hash,
      round = EXCLUDED.round,
      timestamp = EXCLUDED.timestamp,
      transactions_count = EXCLUDED.transactions_count,
      block_reward = EXCLUDED.block_reward
    `;
    await this.query(query, [
      block.height,
      block.hash,
      block.previous_hash,
      block.round,
      block.timestamp,
      block.transactions_count,
      block.block_reward !== undefined ? block.block_reward.toString() : null
    ]);
  }

  async getTransactionsByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    try {
      const query = `
        SELECT t.* FROM transactions t 
        JOIN blocks b ON t.block_height = b.height 
        WHERE b.validator_address = $1 AND b.timestamp > NOW() - INTERVAL '1 second' * $2 
        ORDER BY t.timestamp DESC
      `;
      const result = await this.query(query, [validatorAddress, timeFrame]);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching transactions for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async bulkInsertBlocks(blocks: BlockAttributes[]): Promise<void> {
    if (blocks.length === 0) return;

    const values = blocks.map(b => [
      b.height,
      b.hash,
      b.previous_hash,
      b.round,
      b.timestamp,
      b.transactions_count,
      b.block_reward !== undefined ? b.block_reward.toString() : null
    ]);

    const query = format(`
      INSERT INTO blocks (height, hash, previous_hash, round, timestamp, transactions_count, block_reward)
      VALUES %L
      ON CONFLICT (height) DO UPDATE SET
        hash = EXCLUDED.hash,
        previous_hash = EXCLUDED.previous_hash,
        round = EXCLUDED.round,
        timestamp = EXCLUDED.timestamp,
        transactions_count = EXCLUDED.transactions_count,
        block_reward = EXCLUDED.block_reward
    `, values);

    await this.query(query);
  }

  async insertTransaction(transaction: any): Promise<void> {
    try {
      await this.query(
        'INSERT INTO transactions (id, block_height, fee, timestamp) VALUES ($1, $2, $3, $4)',
        [transaction.id, transaction.block_height, transaction.fee, transaction.timestamp]
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`BlockDBService insertTransaction error: ${error.message}`);
      }
      throw new Error('BlockDBService insertTransaction error: An unknown error occurred');
    }
  }

  async getBlockCountInHeightRange(startHeight: number, endHeight: number): Promise<number> {
    const query = `
      SELECT COUNT(*) AS count
      FROM blocks
      WHERE height >= $1 AND height <= $2
    `;
    const result = await this.query(query, [startHeight, endHeight]);
    return parseInt(result.rows[0].count, 10);
  }

  async getValidatorBlockCountInHeightRange(validatorAddress: string, startHeight: number, endHeight: number): Promise<number> {
    const query = `
      SELECT COUNT(*) AS count
      FROM blocks
      WHERE validator_address = $1
        AND height >= $2 AND height <= $3
    `;
    const result = await this.query(query, [validatorAddress, startHeight, endHeight]);
    return parseInt(result.rows[0].count, 10);
  }

  async getBlocksCountByValidator(validatorAddress: string, timeFrame: number): Promise<number> {
    const query = `
      SELECT COUNT(*) as block_count
      FROM blocks
      WHERE validator_address = $1 AND timestamp > (EXTRACT(EPOCH FROM NOW()) * 1000 - $2)
    `;
    const result = await this.query(query, [validatorAddress, timeFrame]);
    return parseInt(result.rows[0].block_count);
  }

  async getLatestBlocks(limit: number = 100): Promise<any[]> {
    try {
      const query = `
        SELECT *
        FROM blocks
        ORDER BY height DESC
        LIMIT $1
      `;
      const result = await this.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error getting latest blocks:', error);
      throw error;
    }
  }

  async getTotalBlocksInTimeFrame(timeFrame: number): Promise<number> {
    try {
      const query = `
        SELECT COUNT(*) as total_blocks
        FROM blocks
        WHERE timestamp > NOW() - INTERVAL '1 second' * $1
      `;
      const result = await this.query(query, [timeFrame]);
      return parseInt(result.rows[0].total_blocks);
    } catch (error) {
      logger.error('Error getting total blocks in time frame:', error);
      throw error;
    }
  }

  async getValidatorBatches(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    const query = `
      SELECT b.* FROM batches b
      JOIN blocks bl ON b.block_height = bl.height
      WHERE b.author = $1 AND bl.timestamp >= $2 AND bl.timestamp <= $3
    `;
    
    logger.debug(`Querying batches for validator ${validatorAddress} between ${startTime} and ${endTime}`);
  
    const result = await this.query(query, [validatorAddress, startTime, endTime]);
  
    logger.debug(`Found ${result.rows.length} batches for validator ${validatorAddress}`);
  
    return result.rows;
  }

  async checkBatchesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    const query = 'SELECT COUNT(*) as count FROM batches WHERE block_height BETWEEN $1 AND $2';
    const result = await this.query(query, [startHeight, endHeight]);
    return parseInt(result.rows[0].count) > 0;
  }

  async bulkInsertBatchInfos(batchInfos: any[], client?: PoolClient): Promise<void> {
    if (batchInfos.length === 0) return;

    const uniqueBatchInfos = Array.from(new Map(batchInfos.map(item => [item.batch_id + '-' + item.round, item])).values());

    const values = uniqueBatchInfos.map(b => [
      b.batch_id,
      b.author,
      b.block_height,
      b.round,
      b.timestamp,
      b.committee_id || 'unknown'
    ]);

    const query = format(`
      INSERT INTO batches (batch_id, author, block_height, round, timestamp, committee_id)
      VALUES %L
      ON CONFLICT (batch_id, round) DO UPDATE SET
        author = EXCLUDED.author,
        block_height = EXCLUDED.block_height,
        timestamp = EXCLUDED.timestamp,
        committee_id = EXCLUDED.committee_id
    `, values);

    if (client) {
      await client.query(query);
    } else {
      await this.query(query);
    }
  }
  async getEarliestBlockHeight(): Promise<number> {
    try {
      const query = `
        SELECT MIN(height) as min_height
        FROM blocks
      `;
      const result = await this.query(query);
      
      if (result.rows.length === 0 || result.rows[0].min_height === null) {
        logger.warn('Veritabanında hiç blok bulunamadı');
        return 0;
      }
      
      return result.rows[0].min_height;
    } catch (error) {
      logger.error(`En erken blok yüksekliği alınırken hata oluştu: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
      throw error;
    }
  }

  async getBlockHeightByTimestamp(timestamp: number): Promise<number> {
    try {
      const query = `
        SELECT height 
        FROM blocks 
        WHERE timestamp <= $1 
        ORDER BY timestamp DESC 
        LIMIT 1
      `;
      const result = await this.query(query, [timestamp]);
      
      if (result.rows.length === 0) {
        logger.warn(`No block found for timestamp ${timestamp}`);
        return 0;
      }
      
      return result.rows[0].height;
    } catch (error) {
      logger.error(`getBlockHeightByTimestamp için hata oluştu: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
      throw error;
    }
  }

  async getBlockByHeight(height: number): Promise<BlockAttributes | null> {
    try {
      const query = `
        SELECT *
        FROM blocks
        WHERE height = $1
      `;
      const result = await this.query(query, [height]);
      
      if (result.rows.length === 0) {
        logger.warn(`Yükseklik ${height} için blok bulunamadı`);
        return null;
      }
      
      const block = result.rows[0];
      return {
        ...block,
        block_reward: block.block_reward ? BigInt(block.block_reward) : undefined
      };
    } catch (error) {
      logger.error(`${height} yüksekliğindeki blok alınırken hata oluştu: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
      throw error;
    }
  }

  async getBlockReward(blockHeight: number): Promise<bigint | null> {
    try {
      const query = 'SELECT block_reward FROM blocks WHERE height = $1';
      const result = await this.query(query, [blockHeight]);
      
      if (result.rows.length === 0) {
        logger.warn(`No block found for height ${blockHeight}`);
        return null;
      }
      
      const blockReward = result.rows[0].block_reward;
      return blockReward ? BigInt(blockReward) : null;
    } catch (error) {
      logger.error(`Error getting block reward for height ${blockHeight}:`, error);
      throw error;
    }
  }
}