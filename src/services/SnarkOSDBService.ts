import pkg from 'pg';
const { Pool } = pkg;
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { Block } from '../types/Block.js';

type CommitteeEntry = {
  id: number;
  validator_address: string;
  start_height: number;
  end_height: number | null;
};

export class SnarkOSDBService {
  private pool: pkg.Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', err);
      process.exit(-1);
    });

    this.pool.connect((err, client, done) => {
      if (err) {
        logger.error('Error connecting to the database', err);
      } else {
        logger.info('Successfully connected to the database');
        done();
      }
    });
  }

  async checkDatabaseStructure(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const tables = ['validators', 'blocks', 'committee_entries', 'delegations', 'rewards'];
      const indexes = [
        'idx_blocks_validator_address',
        'idx_blocks_timestamp',
        'idx_committee_entries_validator',
        'idx_delegations_validator',
        'idx_rewards_validator'
      ];

      for (const table of tables) {
        const result = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = $1
          )
        `, [table]);
        if (!result.rows[0].exists) {
          logger.info(`Table ${table} does not exist`);
          return false;
        }
      }

      for (const index of indexes) {
        const result = await client.query(`
          SELECT EXISTS (
            SELECT FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = $1
          )
        `, [index]);
        if (!result.rows[0].exists) {
          logger.info(`Index ${index} does not exist`);
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error("Error checking database structure:", error);
      return false;
    } finally {
      client.release();
    }
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
          uptime FLOAT,
          total_blocks_produced INTEGER,
          total_rewards BIGINT,
          commission_rate FLOAT,
          last_uptime_update TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS blocks (
          height INTEGER PRIMARY KEY,
          hash TEXT UNIQUE,
          previous_hash TEXT,
          timestamp TIMESTAMP,
          validator_address TEXT,
          total_fees BIGINT
        );

        CREATE TABLE IF NOT EXISTS committee_entries (
          id SERIAL PRIMARY KEY,
          validator_address TEXT,
          start_height BIGINT NOT NULL,
          end_height BIGINT,
          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS delegations (
          id SERIAL PRIMARY KEY,
          delegator_address TEXT,
          validator_address TEXT,
          amount BIGINT,
          timestamp TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS rewards (
          id SERIAL PRIMARY KEY,
          validator_address TEXT,
          amount BIGINT,
          block_height INTEGER,
          timestamp TIMESTAMP
        );
      `);
      logger.info("Database tables created successfully");
    } catch (error) {
      logger.error("Database initialization error:", error);
      throw error;
    }
  }

  async checkAndUpdateSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const tables = ['validators', 'blocks', 'committee_entries', 'delegations', 'rewards'];
      for (const table of tables) {
        await this.checkAndUpdateTable(client, table);
      }

      await client.query('COMMIT');
      logger.info("Schema check and update completed successfully");
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error("Schema check and update error:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async checkAndUpdateTable(client: pkg.PoolClient, table: string): Promise<void> {
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);

    const currentColumns = new Set(rows.map(row => row.column_name));

    const expectedColumns = this.getExpectedColumns(table);
    for (const [columnName, columnDef] of Object.entries(expectedColumns)) {
      if (!currentColumns.has(columnName)) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnDef}`);
        logger.info(`Added column ${columnName} to table ${table}`);
      }
    }
  }

  private getExpectedColumns(table: string): { [key: string]: string } {
    const columnDefinitions: { [key: string]: { [key: string]: string } } = {
      validators: {
        address: 'TEXT PRIMARY KEY',
        stake: 'BIGINT',
        is_active: 'BOOLEAN',
        bonded: 'BIGINT',
        last_seen: 'TIMESTAMP',
        uptime: 'FLOAT',
        total_blocks_produced: 'INTEGER',
        total_rewards: 'BIGINT',
        commission_rate: 'FLOAT',
        last_uptime_update: 'TIMESTAMP'
      },
      blocks: {
        height: 'BIGINT PRIMARY KEY',
        hash: 'TEXT UNIQUE NOT NULL',
        previous_hash: 'TEXT NOT NULL',
        timestamp: 'TIMESTAMP',
        transactions: 'JSONB',
        validator_address: 'TEXT',
        total_fees: 'BIGINT',
        transactions_count: 'INTEGER'
      },
      committee_entries: {
        id: 'SERIAL PRIMARY KEY',
        validator_address: 'TEXT',
        start_height: 'BIGINT NOT NULL',
        end_height: 'BIGINT',
        created_at: 'TIMESTAMP DEFAULT NOW()'
      },
      delegations: {
        id: 'SERIAL PRIMARY KEY',
        delegator_address: 'TEXT',
        validator_address: 'TEXT',
        amount: 'BIGINT',
        timestamp: 'TIMESTAMP'
      },
      rewards: {
        id: 'SERIAL PRIMARY KEY',
        validator_address: 'TEXT',
        amount: 'BIGINT',
        block_height: 'INTEGER',
        timestamp: 'TIMESTAMP'
      }
    };

    return columnDefinitions[table] || {};
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
    try {
      await this.pool.query(
        `INSERT INTO blocks (height, hash, previous_hash, timestamp, transactions, validator_address, total_fees, transactions_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (height) DO UPDATE
         SET hash = EXCLUDED.hash,
             previous_hash = EXCLUDED.previous_hash,
             timestamp = EXCLUDED.timestamp,
             transactions = EXCLUDED.transactions,
             validator_address = EXCLUDED.validator_address,
             total_fees = EXCLUDED.total_fees,
             transactions_count = EXCLUDED.transactions_count`,
        [
          block.height,
          block.hash,
          block.previous_hash,
          block.timestamp,
          JSON.stringify(block.transactions),
          block.validator_address,
          block.total_fees?.toString(),
          block.transactions_count
        ]
      );
    } catch (error) {
      logger.error('Error inserting block:', error);
      throw error;
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

  async updateValidator(address: string, stake: bigint, isActive: boolean, bonded: bigint): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE validators SET stake = $1, is_active = $2, bonded = $3, last_seen = NOW() WHERE address = $4',
        [stake.toString(), isActive, bonded.toString(), address]
      );
    } catch (error) {
      logger.error(`Error updating validator ${address}:`, error);
      throw error;
    }
  }

  async insertValidator(address: string, stake: bigint, isActive: boolean, bonded: bigint): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO validators (address, stake, is_active, bonded, last_seen) VALUES ($1, $2, $3, $4, NOW())',
        [address, stake.toString(), isActive, bonded.toString()]
      );
    } catch (error) {
      logger.error(`Error inserting validator ${address}:`, error);
      throw error;
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
        const query = `
          INSERT INTO blocks (height, hash, previous_hash, timestamp, transactions, validator_address, total_fees, transactions_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (height) DO UPDATE
          SET hash = EXCLUDED.hash,
              previous_hash = EXCLUDED.previous_hash,
              timestamp = EXCLUDED.timestamp,
              transactions = EXCLUDED.transactions,
              validator_address = EXCLUDED.validator_address,
              total_fees = EXCLUDED.total_fees,
              transactions_count = EXCLUDED.transactions_count;
        `;
        const values = [
          block.height,
          block.hash,
          block.previous_hash,
          block.timestamp,
          JSON.stringify(block.transactions),
          block.validator_address,
          block.total_fees?.toString(),
          block.transactions_count
        ];
        await client.query(query, values);
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

  async getCommitteeEntriesForValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    try {
      const result = await this.pool.query(`
        SELECT start_height, end_height
        FROM committee_entries
        WHERE validator_address = $1
        AND start_height >= (SELECT MAX(height) - $2 FROM blocks)
        ORDER BY start_height DESC
      `, [validatorAddress, timeFrame]);
      return result.rows;
    } catch (error) {
      logger.error(`Error getting committee entries for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async getBlockCountBetween(startHeight: number, endHeight: number): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as block_count
        FROM blocks
        WHERE height BETWEEN $1 AND $2
      `, [startHeight, endHeight]);
      return parseInt(result.rows[0].block_count);
    } catch (error) {
      logger.error(`Error getting block count between heights ${startHeight} and ${endHeight}:`, error);
      throw error;
    }
  }

  async getBlocksCountByValidatorInRange(validatorAddress: string, startHeight: number, endHeight: number): Promise<number> {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as block_count
        FROM blocks
        WHERE validator_address = $1 AND height BETWEEN $2 AND $3
      `, [validatorAddress, startHeight, endHeight]);
      return parseInt(result.rows[0].block_count);
    } catch (error) {
      logger.error(`Error getting blocks count for validator ${validatorAddress} in range:`, error);
      throw error;
    }
  }

  async insertCommitteeEntry(validatorAddress: string, startHeight: number, endHeight?: number): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO committee_entries (validator_address, start_height, end_height)
        VALUES ($1, $2, $3)
        ON CONFLICT (validator_address, start_height) DO UPDATE SET
          end_height = EXCLUDED.end_height
      `, [validatorAddress, startHeight, endHeight]);
    } catch (error) {
      console.error("Error inserting committee entry:", error);
      throw error;
    }
  }

  async insertOrUpdateValidator(address: string, stake: bigint): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO validators (address, stake, is_active, bonded, last_seen)
        VALUES ($1, $2, true, $2, NOW())
        ON CONFLICT (address) DO UPDATE SET
          stake = $2,
          is_active = true,
          bonded = $2,
          last_seen = NOW()
      `, [address, stake.toString()]);
    } catch (error) {
      console.error("Error inserting or updating validator:", error);
      throw error;
    }
  }

  public async getCommitteeEntries(validatorAddress: string, startHeight: number, endHeight: number): Promise<CommitteeEntry[]> {
    const query = `
      SELECT *
      FROM committee_entries
      WHERE validator_address = $1
        AND (start_height <= $2) AND (end_height IS NULL OR end_height >= $3)
    `;
    const values = [validatorAddress, endHeight, startHeight];
    const result = await this.pool.query(query, values);
    return result.rows;
  }

  public async getBlockCountInHeightRange(startHeight: number, endHeight: number): Promise<number> {
    const query = `
      SELECT COUNT(*) AS count
      FROM blocks
      WHERE height >= $1 AND height <= $2
    `;
    const values = [startHeight, endHeight];
    const result = await this.pool.query(query, values);
    return parseInt(result.rows[0].count, 10);
  }

  public async getValidatorBlockCountInHeightRange(validatorAddress: string, startHeight: number, endHeight: number): Promise<number> {
    const query = `
      SELECT COUNT(*) AS count
      FROM blocks
      WHERE validator_address = $1
        AND height >= $2 AND height <= $3
    `;
    const values = [validatorAddress, startHeight, endHeight];
    const result = await this.pool.query(query, values);
    return parseInt(result.rows[0].count, 10);
  }

  async updateValidatorUptime(validatorAddress: string, uptime: number, lastUptimeUpdate: Date): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE validators 
         SET uptime = $1, last_uptime_update = $2
         WHERE address = $3`,
        [uptime, lastUptimeUpdate, validatorAddress]
      );
    } catch (error) {
      logger.error(`Error updating uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async updateCommitteeMap(committee: Record<string, [bigint, boolean, bigint]>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [address, [stake, isOpen, commission]] of Object.entries(committee)) {
        await client.query(
          'INSERT INTO mapping_committee_history (address, stake, is_open, commission, timestamp) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (address) DO UPDATE SET stake = $2, is_open = $3, commission = $4, timestamp = NOW()',
          [address, stake.toString(), isOpen, commission.toString()]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating committee map:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateBondedMap(bondedMap: Map<string, bigint>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [address, microcredits] of bondedMap.entries()) {
        await client.query(
          'INSERT INTO mapping_bonded_history (address, microcredits, timestamp) VALUES ($1, $2, NOW()) ON CONFLICT (address) DO UPDATE SET microcredits = $2, timestamp = NOW()',
          [address, microcredits.toString()]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating bonded map:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDelegatedMap(delegatedMap: Map<string, bigint>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [address, microcredits] of delegatedMap.entries()) {
        await client.query(
          'INSERT INTO mapping_delegated_history (address, microcredits, timestamp) VALUES ($1, $2, NOW()) ON CONFLICT (address) DO UPDATE SET microcredits = $2, timestamp = NOW()',
          [address, microcredits.toString()]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating delegated map:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateNetworkTotalStake(totalStake: bigint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'INSERT INTO network_total_stake (total_stake, timestamp) VALUES ($1, NOW())',
        [totalStake.toString()]
      );
    } catch (error) {
      logger.error('Error updating network total stake:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

export default SnarkOSDBService;