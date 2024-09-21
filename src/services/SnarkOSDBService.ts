import pg from 'pg';
import logger from '../utils/logger.js';
import { Block } from '../types/Block.js';

const { Pool: PgPool } = pg;

export class SnarkOSDBService {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new PgPool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async initializeDatabase(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS validators (
          address TEXT PRIMARY KEY,
          stake BIGINT,
          is_active BOOLEAN,
          bonded BIGINT,
          last_seen TIMESTAMP,
          total_blocks_produced INTEGER DEFAULT 0,
          total_rewards BIGINT DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_validators_stake ON validators(stake);
        CREATE INDEX IF NOT EXISTS idx_validators_is_active ON validators(is_active);

        CREATE TABLE IF NOT EXISTS blocks (
          height BIGINT PRIMARY KEY,
          hash TEXT NOT NULL,
          previous_hash TEXT,
          timestamp BIGINT NOT NULL,
          transactions_count INT NOT NULL,
          validator_address TEXT,
          total_fees BIGINT
        );

        CREATE INDEX IF NOT EXISTS idx_blocks_validator_address ON blocks(validator_address);
        CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);

        -- Eğer previous_hash sütunu yoksa ekle
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='blocks' AND column_name='previous_hash') THEN
            ALTER TABLE blocks ADD COLUMN previous_hash TEXT;
          END IF;
        END $$;
      `);
      console.log("Database tables and indexes successfully created and updated");
      
      // Mevcut sütunları kontrol et
      const result = await this.pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'blocks';
      `);
      console.log("Existing columns in blocks table:", result.rows.map(row => row.column_name));
    } catch (error) {
      console.error("Database initialization error:", error);
      throw error;
    }
  }

  async getValidators(): Promise<any[]> {
    try {
      const result = await this.pool.query('SELECT * FROM validators');
      return result.rows;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`SnarkOS DB getValidators error: ${error.message}`);
      }
      throw new Error('SnarkOS DB getValidators error: An unknown error occurred');
    }
  }

  async getBlocksByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    const query = `
      SELECT * FROM blocks 
      WHERE validator_address = $1 
      AND timestamp > NOW() - INTERVAL '1 second' * $2 
      ORDER BY height DESC
    `;
    const result = await this.pool.query(query, [validatorAddress, timeFrame]);
    return result.rows;
  }

  async getTransactionsByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    try {
      const result = await this.pool.query(
        'SELECT t.* FROM transactions t JOIN blocks b ON t.block_height = b.height WHERE b.validator_address = $1 AND b.timestamp > NOW() - INTERVAL \'1 second\' * $2 ORDER BY t.timestamp DESC',
        [validatorAddress, timeFrame]
      );
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching transactions for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async insertBlock(block: Block): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      console.log("Inserting block:", JSON.stringify(block, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));
      await client.query(
        'INSERT INTO blocks (height, hash, previous_hash, timestamp, transactions_count, validator_address, total_fees) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          block.height,
          block.hash,
          block.previous_hash,
          block.timestamp ? new Date(block.timestamp).toISOString() : null,
          block.transactions.length,
          block.validator_address,
          block.total_fees ? block.total_fees.toString() : null
        ]
      );
      if (block.validator_address && block.total_fees) {
        await client.query(
          'UPDATE validators SET total_blocks_produced = total_blocks_produced + 1, total_rewards = total_rewards + $1, last_seen = $2 WHERE address = $3',
          [block.total_fees.toString(), block.timestamp ? new Date(block.timestamp) : new Date(), block.validator_address]
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof Error) {
        console.error("Error details:", error);
        throw new Error(`SnarkOS DB insertBlock error: ${error.message}`);
      }
      throw new Error('SnarkOS DB insertBlock error: An unknown error occurred');
    } finally {
      client.release();
    }
  }

  async insertTransaction(transaction: any): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO transactions (id, block_height, fee, timestamp) VALUES ($1, $2, $3, $4)',
        [transaction.id, transaction.block_height, transaction.fee, transaction.timestamp]
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`SnarkOS DB insertTransaction error: ${error.message}`);
      }
      throw new Error('SnarkOS DB insertTransaction error: An unknown error occurred');
    }
  }

  async updateValidator(address: string, stake: bigint): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO validators (address, stake, last_seen, total_blocks_produced, total_rewards) VALUES ($1, $2, NOW(), 0, 0) ON CONFLICT (address) DO UPDATE SET stake = $2, last_seen = NOW()',
        [address, stake]
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`SnarkOS DB updateValidator error: ${error.message}`);
      }
      throw new Error('SnarkOS DB updateValidator error: An unknown error occurred');
    }
  }

  async executeQuery(query: string, params: any[] = []): Promise<any> {
    return this.pool.query(query, params);
  }

  public async query(sql: string, params?: any[]): Promise<{ rows: any[] }> {
    try {
      const result = await this.pool.query(sql, params);
      return result;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Query error:', error.message);
        throw new Error(`Database query failed: ${error.message}`);
      }
      console.error('Query error: An unknown error occurred');
      throw new Error('Database query failed: An unknown error occurred');
    }
  }

  async monitorValidatorPerformance(address: string, timeWindow: number): Promise<{
    blocksProduced: number,
    totalRewards: bigint,
    averageBlockTime: number
  }> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - timeWindow * 1000);

    const blocks = await this.query(
      'SELECT * FROM blocks WHERE validator_address = $1 AND timestamp BETWEEN $2 AND $3 ORDER BY height',
      [address, startTime, endTime]
    );

    const blocksProduced = blocks.rows.length;
    const totalRewards = blocks.rows.reduce((sum, block) => sum + BigInt(block.total_fees), BigInt(0));

    let averageBlockTime = 0;
    if (blocksProduced > 1) {
      const totalTime = blocks.rows[blocksProduced - 1].timestamp.getTime() - blocks.rows[0].timestamp.getTime();
      averageBlockTime = totalTime / (blocksProduced - 1);
    }

    return { blocksProduced, totalRewards, averageBlockTime };
  }

  async getLatestBlockHeight(): Promise<number> {
    try {
      const result = await this.pool.query('SELECT MAX(height) as max_height FROM blocks');
      return result.rows[0].max_height || 0;
    } catch (error) {
      logger.error('Error getting latest block height:', error);
      throw error;
    }
  }

  async saveBlocks(blocks: Block[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const block of blocks) {
        await client.query(
          'INSERT INTO blocks (height, hash, previous_hash, timestamp, transactions_count, validator_address, total_fees) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (height) DO NOTHING',
          [
            block.height,
            block.hash,
            block.previous_hash,
            block.timestamp,
            block.transactions.length,
            block.validator_address,
            block.total_fees
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving blocks:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async testDatabaseOperations(): Promise<void> {
    try {
      // Adding test validator
      const testValidator = {
        address: 'test_address',
        stake: BigInt(1000),
        last_seen: new Date(),
        total_blocks_produced: 0,
        total_rewards: BigInt(0)
      };
      await this.updateValidator(testValidator.address, testValidator.stake);
      logger.info('Test validator added successfully');

      // Adding test block
      const testBlock: Block = {
        height: 999999,
        hash: 'test_hash',
        previous_hash: 'test_previous_hash',
        timestamp: new Date().toISOString(),
        transactions: [],
        validator_address: 'test_address',
        total_fees: BigInt(100)
      };
      await this.insertBlock(testBlock);
      logger.info('Test block added successfully');

      // Fetching added data
      const result = await this.query('SELECT * FROM blocks WHERE height = $1', [999999]);
      logger.info('Fetched test block:', JSON.stringify(result.rows[0], (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));

      // Deleting test data
      await this.query('DELETE FROM blocks WHERE height = $1', [999999]);
      await this.query('DELETE FROM validators WHERE address = $1', ['test_address']);
      logger.info('Test data deleted');
    } catch (error) {
      logger.error('Error during database test operations:', error);
    }
  }

  async updateValidatorBlockProduction(address: string, blockReward: bigint): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE validators SET total_blocks_produced = total_blocks_produced + 1, total_rewards = total_rewards + $1, last_seen = NOW() WHERE address = $2',
        [blockReward.toString(), address] // convert bigint to string
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`SnarkOS DB updateValidatorBlockProduction error: ${error.message}`);
      }
      throw new Error('SnarkOS DB updateValidatorBlockProduction error: An unknown error occurred');
    }
  }

  async getValidatorUptime(validatorAddress: string): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_blocks,
          COUNT(CASE WHEN validator_address = $1 THEN 1 END) as produced_blocks
        FROM blocks
        WHERE timestamp > NOW() - INTERVAL '24 hours'
      `, [validatorAddress]);

      const { total_blocks, produced_blocks } = result.rows[0];
      return (produced_blocks / total_blocks) * 100;
    } catch (error) {
      logger.error(`Error calculating uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getValidatorRewards(validatorAddress: string, timeFrame: number): Promise<string> {
    try {
      const result = await this.pool.query(`
        SELECT SUM(total_fees) as total_rewards
        FROM blocks
        WHERE validator_address = $1 AND timestamp > NOW() - INTERVAL '1 second' * $2
      `, [validatorAddress, timeFrame]);
      return result.rows[0].total_rewards?.toString() || '0';
    } catch (error) {
      logger.error(`Error calculating rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getTotalBlocksInTimeFrame(timeFrame: number): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as total_blocks
        FROM blocks
        WHERE timestamp > NOW() - INTERVAL '1 second' * $1
      `, [timeFrame]);
      return parseInt(result.rows[0].total_blocks);
    } catch (error) {
      logger.error(`Error getting total blocks in time frame:`, error);
      throw error;
    }
  }

  async getBlocksCountByValidator(validatorAddress: string, timeFrame: number): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as block_count
        FROM blocks
        WHERE validator_address = $1 AND timestamp > NOW() - INTERVAL '1 second' * $2
      `, [validatorAddress, timeFrame]);
      return parseInt(result.rows[0].block_count);
    } catch (error) {
      logger.error(`Error getting blocks count for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getTotalValidatorsCount(): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as validator_count
        FROM validators
        WHERE is_active = true
      `);
      return parseInt(result.rows[0].validator_count);
    } catch (error) {
      logger.error('Error getting total validators count:', error);
      throw error;
    }
  }
}

export default SnarkOSDBService;