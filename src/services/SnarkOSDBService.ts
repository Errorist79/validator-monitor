import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { Block, BlockAttributes } from '../database/models/Block.js';
import { CommitteeMember } from '../database/models/CommitteeMember.js';
import { CommitteeParticipation } from '../database/models/CommitteeParticipation.js';
import { Batch } from '../database/models/Batch.js';
import { UptimeSnapshot, UptimeSnapshotAttributes} from '../database/models/UptimeSnapshot.js';
import {AleoSDKService} from './AleoSDKService.js';
import pkg from 'pg';
import format from 'pg-format';
const { Pool } = pkg;

export class SnarkOSDBService {
  private pool: pkg.Pool;
  private aleoSDKService: AleoSDKService;

  constructor(aleoSDKService: AleoSDKService) {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: 20, // Maksimum bağlantı sayısını artırıyoruz
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.aleoSDKService = aleoSDKService;

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
      const tables = [
        'blocks',
        'committee_members',
        'committee_participation',
        'batches',
        'uptime_snapshots',
        'validator_rewards',
        'delegator_rewards',
        'delegations',
        'validator_status',
        'signature_participation'
      ];
      const indexes = [
        'idx_blocks_round',
        'idx_committee_participation_round',
        'idx_batches_round',
        'idx_uptime_snapshots_end_round',
        'idx_validator_rewards_address_height',
        'idx_delegator_rewards_address_height',
        'idx_delegations_validator_address',
        'idx_validator_status_is_active',
        'idx_signature_participation_validator',
        'idx_signature_participation_round'
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
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS blocks (
          height BIGINT PRIMARY KEY,
          hash TEXT UNIQUE NOT NULL,
          previous_hash TEXT NOT NULL,
          round BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          transactions_count INTEGER NOT NULL,
          block_reward NUMERIC
        );

        CREATE INDEX IF NOT EXISTS idx_blocks_round ON blocks(round);

        CREATE TABLE IF NOT EXISTS committee_members (
          address TEXT PRIMARY KEY,
          first_seen_block BIGINT NOT NULL,
          last_seen_block BIGINT,
          total_stake NUMERIC NOT NULL,
          is_open BOOLEAN NOT NULL,
          commission NUMERIC NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          block_height BIGINT NOT NULL,
          last_updated TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS committee_participation (
          id SERIAL PRIMARY KEY,
          validator_address TEXT REFERENCES committee_members(address),
          committee_id TEXT NOT NULL,
          round BIGINT NOT NULL,
          block_height BIGINT REFERENCES blocks(height),
          timestamp BIGINT NOT NULL,
          UNIQUE (validator_address, round)
        );

        CREATE INDEX IF NOT EXISTS idx_committee_participation_round ON committee_participation(round);
        CREATE INDEX IF NOT EXISTS idx_committee_participation_committee_round ON committee_participation(committee_id, round);
        CREATE INDEX IF NOT EXISTS idx_committee_participation_validator ON committee_participation (validator_address);

        CREATE TABLE IF NOT EXISTS batches (
          batch_id TEXT NOT NULL,
          author TEXT NOT NULL,
          round BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          committee_id TEXT NOT NULL DEFAULT 'unknown',
          block_height BIGINT REFERENCES blocks(height),
          PRIMARY KEY (batch_id, round)
        );

        CREATE INDEX IF NOT EXISTS idx_batches_round ON batches(round);
        CREATE INDEX IF NOT EXISTS idx_batches_committee_round ON batches(committee_id, round);
        CREATE INDEX IF NOT EXISTS idx_batches_author ON batches(author);
        CREATE INDEX IF NOT EXISTS idx_batches_author_committee_round ON batches(author, committee_id, round);

        CREATE TABLE IF NOT EXISTS uptime_snapshots (
          id SERIAL PRIMARY KEY,
          validator_address TEXT REFERENCES committee_members(address),
          start_round BIGINT NOT NULL,
          end_round BIGINT NOT NULL,
          total_rounds INTEGER NOT NULL,
          participated_rounds INTEGER NOT NULL,
          uptime_percentage NUMERIC(5,2) NOT NULL,
          calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_uptime_snapshots_end_round ON uptime_snapshots(end_round);

        CREATE TABLE IF NOT EXISTS validator_rewards (
          id SERIAL PRIMARY KEY,
          validator_address TEXT NOT NULL,
          reward NUMERIC NOT NULL,
          block_height BIGINT NOT NULL,
          UNIQUE(validator_address, block_height)
        );

        CREATE INDEX IF NOT EXISTS idx_validator_rewards_address_height ON validator_rewards(validator_address, block_height);

        CREATE TABLE IF NOT EXISTS delegator_rewards (
          id SERIAL PRIMARY KEY,
          delegator_address TEXT NOT NULL,
          reward NUMERIC NOT NULL,
          block_height BIGINT NOT NULL,
          UNIQUE(delegator_address, block_height)
        );

        CREATE INDEX IF NOT EXISTS idx_delegator_rewards_address_height ON delegator_rewards(delegator_address, block_height);

        CREATE TABLE IF NOT EXISTS delegations (
          id SERIAL PRIMARY KEY,
          delegator_address TEXT NOT NULL,
          validator_address TEXT NOT NULL,
          amount NUMERIC NOT NULL,
          UNIQUE(delegator_address, validator_address)
        );

        CREATE INDEX IF NOT EXISTS idx_delegations_validator_address ON delegations(validator_address);

        CREATE TABLE IF NOT EXISTS validator_status (
          address TEXT PRIMARY KEY,
          last_active_round BIGINT,
          consecutive_inactive_rounds INT DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_validator_status_is_active ON validator_status(is_active);

        CREATE TABLE IF NOT EXISTS signature_participation (
          validator_address VARCHAR NOT NULL,
          batch_id VARCHAR NOT NULL,
          round BIGINT NOT NULL,
          committee_id VARCHAR NOT NULL,
          block_height BIGINT NOT NULL,
          timestamp BIGINT NOT NULL,
          PRIMARY KEY (validator_address, batch_id, round)
        );

        CREATE INDEX IF NOT EXISTS idx_signature_participation_validator ON signature_participation (validator_address);
        CREATE INDEX IF NOT EXISTS idx_signature_participation_round ON signature_participation (round);
      `);

      logger.info('Database schema initialized successfully');
    } catch (error) {
      logger.error('Error initializing database schema:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  async checkAndUpdateSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const tables = ['blocks', 'committee_members', 'committee_participation', 'batches', 'uptime_snapshots', 'signature_participation'];
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
    switch (table) {
      case 'blocks':
        return {
          height: 'BIGINT PRIMARY KEY',
          hash: 'TEXT UNIQUE NOT NULL',
          previous_hash: 'TEXT NOT NULL',
          round: 'BIGINT NOT NULL',
          timestamp: 'BIGINT NOT NULL',
          transactions_count: 'INTEGER NOT NULL',
          block_reward: 'NUMERIC'
        };
      case 'committee_members':
        return {
          address: 'TEXT PRIMARY KEY',
          first_seen_block: 'BIGINT NOT NULL',
          last_seen_block: 'BIGINT',
          total_stake: 'NUMERIC NOT NULL',
          is_open: 'BOOLEAN NOT NULL',
          commission: 'NUMERIC NOT NULL',
          is_active: 'BOOLEAN NOT NULL DEFAULT true',
          last_updated: 'TIMESTAMP NOT NULL DEFAULT NOW()'
        };
      case 'committee_participation':
        return {
          id: 'SERIAL PRIMARY KEY',
          validator_address: 'TEXT REFERENCES committee_members(address)',
          committee_id: 'TEXT NOT NULL',
          round: 'BIGINT NOT NULL',
          block_height: 'BIGINT REFERENCES blocks(height)',
          timestamp: 'BIGINT NOT NULL'
        };
      case 'batches':
        return {
          batch_id: 'TEXT NOT NULL',
          author: 'TEXT NOT NULL',
          round: 'BIGINT NOT NULL',
          timestamp: 'BIGINT NOT NULL',
          committee_id: 'TEXT NOT NULL',
          block_height: 'BIGINT REFERENCES blocks(height)'
        };
      case 'uptime_snapshots':
        return {
          id: 'SERIAL PRIMARY KEY',
          validator_address: 'TEXT REFERENCES committee_members(address)',
          start_round: 'BIGINT NOT NULL',
          end_round: 'BIGINT NOT NULL',
          total_rounds: 'INTEGER NOT NULL',
          participated_rounds: 'INTEGER NOT NULL',
          uptime_percentage: 'NUMERIC(5,2) NOT NULL',
          calculated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        };
      case 'validator_status':
        return {
          address: 'TEXT PRIMARY KEY',
          last_active_round: 'BIGINT NOT NULL',
          consecutive_inactive_rounds: 'INTEGER NOT NULL DEFAULT 0',
          is_active: 'BOOLEAN NOT NULL',
          last_updated: 'TIMESTAMP NOT NULL DEFAULT NOW()'
        };
      case 'signature_participation':
        return {
          validator_address: 'TEXT NOT NULL',
          batch_id: 'TEXT NOT NULL',
          round: 'BIGINT NOT NULL',
          committee_id: 'TEXT NOT NULL',
          block_height: 'BIGINT NOT NULL',
          timestamp: 'BIGINT NOT NULL',
        };
      default:
        return {};
    }
  }

  async getValidators(): Promise<any[]> {
    const query = 'SELECT * FROM committee_members';
    const result = await this.pool.query(query);
    logger.debug(`Retrieved ${result.rows.length} validators from the database`);
    return result.rows;
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
    await this.pool.query(query, [
      block.height,
      block.hash,
      block.previous_hash,
      block.round,
      block.timestamp,
      block.transactions_count,
      block.block_reward !== undefined ? block.block_reward.toString() : null
    ]);
  }

  async upsertBlocks(blocks: BlockAttributes[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const block of blocks) {
        await this.upsertBlock(block);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
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

  async updateValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    const query = `
      UPDATE committee_members 
      SET stake = $2, is_open = $3, commission = $4, last_updated = NOW()
      WHERE address = $1
    `;
    await this.pool.query(query, [address, stake.toString(), isOpen, commission.toString()]);
  }

  async insertValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    const query = `
      INSERT INTO committee_members (address, stake, is_open, commission, first_seen_block, last_updated)
      VALUES ($1, $2, $3, $4, (SELECT MAX(height) FROM blocks), NOW())
    `;
    await this.pool.query(query, [address, stake.toString(), isOpen, commission.toString()]);
  }

  async deactivateValidator(address: string): Promise<void> {
    const query = `
      UPDATE committee_members
      SET is_active = false, last_updated = NOW()
      WHERE address = $1
    `;
    await this.pool.query(query, [address]);
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

  async updateValidatorUptime(
    address: string,
    startRound: bigint,
    endRound: bigint,
    totalRounds: bigint,
    participatedRounds: bigint,
    uptimePercentage: number
  ): Promise<void> {
    const query = `
      INSERT INTO uptime_snapshots 
      (validator_address, start_round, end_round, total_rounds, participated_rounds, uptime_percentage, calculated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `;
    await this.pool.query(query, [
      address,
      startRound.toString(),
      endRound.toString(),
      totalRounds.toString(),
      participatedRounds.toString(),
      uptimePercentage
    ]);
  }

  async getValidatorParticipation(validatorAddress: string, startRound: bigint, endRound: bigint): Promise<Array<{ committee_id: string; rounds: bigint[] }>> {
    const query = `
      SELECT committee_id, array_agg(DISTINCT round ORDER BY round) as rounds
      FROM committee_participation
      WHERE validator_address = $1 AND round BETWEEN $2 AND $3
      GROUP BY committee_id
    `;
    const result = await this.pool.query(query, [validatorAddress, startRound.toString(), endRound.toString()]);
    return result.rows.map((row: any) => ({
      committee_id: row.committee_id as string,
      rounds: (row.rounds as any[]).map(r => BigInt(r))
    }));
  }

  async getLastUptimeSnapshot(address: string): Promise<any | null> {
    const query = `
      SELECT * FROM uptime_snapshots
      WHERE validator_address = $1
      ORDER BY end_round DESC
      LIMIT 1
    `;
    const result = await this.pool.query(query, [address]);
    return result.rows[0] || null;
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

  async getCommitteeEntriesForValidator(validatorAddress: string, startTimestamp: number, endTimestamp: number): Promise<CommitteeParticipation[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT cp.id, cp.validator_address, cp.committee_id, cp.round, cp.block_height, cp.timestamp
         FROM committee_participation cp
         JOIN committee_members cm ON cp.validator_address = cm.address
         WHERE cm.address = $1 AND cp.timestamp BETWEEN $2 AND $3
         ORDER BY cp.timestamp`,
        [validatorAddress, startTimestamp, endTimestamp]
      );
      return result.rows;
    } catch (error) {
      logger.error('Error getting committee entries for validator:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getValidatorBatches(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    const query = `
      SELECT * FROM batches 
      WHERE author = $1 AND timestamp >= $2 AND timestamp <= $3
    `;
    
    // Parametreleri kontrol etmek için log ekleyelim
    logger.debug(`Validator ${validatorAddress} için ${startTime} ile ${endTime} arasındaki batch'ler sorgulanıyor`);
  
    const result = await this.pool.query(query, [validatorAddress, startTime, endTime]);
  
    logger.debug(`Validator ${validatorAddress} için bulunan batch sayısı: ${result.rows.length}`);
  
    return result.rows;
  }

  async insertUptimeSnapshot(snapshot: Omit<UptimeSnapshotAttributes, 'id'>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO uptime_snapshots (validator_address, start_round, end_round, total_rounds, participated_rounds, uptime_percentage, calculated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [snapshot.validator_address, snapshot.start_round, snapshot.end_round, snapshot.total_rounds, snapshot.participated_rounds, snapshot.uptime_percentage, snapshot.calculated_at]
      );
    } catch (error) {
      logger.error('Error inserting uptime snapshot:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTotalCommittees(startRound: bigint, endRound: bigint): Promise<{ committee_id: string, rounds: bigint[] }[]> {
    const query = `
      SELECT committee_id, ARRAY_AGG(DISTINCT round) as rounds
      FROM batches
      WHERE round BETWEEN $1 AND $2
      GROUP BY committee_id
    `;
    const result = await this.pool.query(query, [startRound.toString(), endRound.toString()]);
    return result.rows.map(row => ({
      committee_id: row.committee_id,
      rounds: row.rounds.map((round: string) => BigInt(round))
    }));
  }

  async getBatchInfoByCommitteeAndRound(committeeId: string, round: bigint): Promise<any | null> {
    const query = `
      SELECT * FROM batches
      WHERE committee_id = $1 AND round = $2
      ORDER BY block_height ASC
      LIMIT 1
    `;
    const result = await this.pool.query(query, [committeeId, round.toString()]);
    return result.rows[0] || null;
  }

  async updateValidatorStatus(address: string, currentRound: bigint, isActive: boolean): Promise<void> {
    const query = `
      INSERT INTO validator_status (address, last_active_round, consecutive_inactive_rounds, is_active, last_updated)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (address) DO UPDATE
      SET last_active_round = CASE
            WHEN $4 = true THEN $2
            ELSE validator_status.last_active_round
          END,
          consecutive_inactive_rounds = CASE
            WHEN $4 = true THEN 0
            ELSE validator_status.consecutive_inactive_rounds + 1
          END,
          is_active = $4,
          last_updated = NOW()
    `;
    
    await this.pool.query(query, [address, currentRound.toString(), 0, isActive]);
    logger.debug(`Updated status for validator ${address}: isActive=${isActive}, lastActiveRound=${currentRound}`);
  }

  async getActiveValidators(): Promise<string[]> {
    const query = 'SELECT address FROM committee_members WHERE is_active = true';
    const result = await this.pool.query(query);
    logger.debug(`Retrieved ${result.rows.length} active validators`);
    return result.rows.map(row => row.address);
  }

  async getValidatorByAddress(address: string): Promise<any | null> {
    try {
      const result = await this.pool.query('SELECT * FROM committee_members WHERE address = $1', [address]);
      return result.rows[0] || null;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`SnarkOS DB getValidatorByAddress error: ${error.message}`);
      }
      throw new Error('SnarkOS DB getValidatorByAddress error: An unknown error occurred');
    }
  }

  async getEarliestValidatorRound(validatorAddress: string): Promise<bigint | null> {
    const query = `
      SELECT MIN(round) as min_round FROM committee_participation
      WHERE validator_address = $1
    `;
    const result = await this.pool.query(query, [validatorAddress]);
    return result.rows[0].min_round ? BigInt(result.rows[0].min_round) : null;
  }

  async updateBlockReward(blockHash: string, reward: bigint): Promise<void> {
    const query = 'UPDATE blocks SET block_reward = $1 WHERE hash = $2';
    await this.pool.query(query, [reward.toString(), blockHash]);
  }

  async updateValidatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    const query = `
      INSERT INTO validator_rewards (validator_address, reward, block_height)
      VALUES ($1, $2, $3)
      ON CONFLICT (validator_address, block_height)
      DO UPDATE SET reward = EXCLUDED.reward
    `;
    await this.pool.query(query, [address, reward.toString(), blockHeight.toString()]);
  }

  async updateDelegatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    const query = `
      INSERT INTO delegator_rewards (delegator_address, reward, block_height)
      VALUES ($1, $2, $3)
      ON CONFLICT (delegator_address, block_height)
      DO UPDATE SET reward = EXCLUDED.reward
    `;
    await this.pool.query(query, [address, reward.toString(), blockHeight.toString()]);
  }

  async getDelegators(validatorAddress: string): Promise<Array<{ address: string, amount: bigint }>> {
    const query = 'SELECT delegator_address, amount FROM delegations WHERE validator_address = $1';
    const result = await this.pool.query(query, [validatorAddress]);
    return result.rows.map(row => ({
      address: row.delegator_address,
      amount: BigInt(row.amount)
    }));
  }

  async getValidatorRewardsInRange(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    const query = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM validator_rewards
      WHERE validator_address = $1 AND block_height BETWEEN $2 AND $3
    `;
    const result = await this.pool.query(query, [validatorAddress, startBlock, endBlock]);
    return BigInt(result.rows[0].total_rewards || 0);
  }

  async getDelegatorRewardsInRange(delegatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    const query = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM delegator_rewards
      WHERE delegator_address = $1 AND block_height BETWEEN $2 AND $3
    `;
    const result = await this.pool.query(query, [delegatorAddress, startBlock, endBlock]);
    return BigInt(result.rows[0].total_rewards || 0);
  }

  async insertOrUpdateCommitteeMember(
    address: string, 
    blockHeight: number, 
    total_stake: bigint, 
    isOpen: boolean, 
    commission: bigint
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO committee_members (address, first_seen_block, last_seen_block, total_stake, is_open, commission, last_updated)
         VALUES ($1, $2, $2, $3, $4, $5, NOW())
         ON CONFLICT (address) DO UPDATE SET 
         last_seen_block = $2,
         total_stake = $3,
         is_open = $4,
         commission = $5,
         last_updated = NOW()`,
        [address, blockHeight, total_stake.toString(), isOpen, commission.toString()]
      );
  
      // validator_status tablosunu güncelle
      await this.updateValidatorStatus(address, BigInt(blockHeight), true);
    } catch (error) {
      logger.error('Error inserting or updating committee member:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async insertCommitteeParticipation(participation: {
    validator_address: string;
    committee_id: string;
    round: number;
    block_height: number;
    timestamp: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO committee_participation (validator_address, committee_id, round, block_height, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (validator_address, round) DO NOTHING`,
        [
          participation.validator_address,
          participation.committee_id,
          participation.round,
          participation.block_height,
          participation.timestamp
        ]
      );
    } catch (error) {
      logger.error('Error inserting committee participation:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async insertBatch(batch: {
    batch_id: string;
    author: string;
    round: number;
    timestamp: number;
    committee_id: string;
    block_height: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO batches (batch_id, author, round, timestamp, committee_id, block_height)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (batch_id, round) DO NOTHING`,
        [batch.batch_id, batch.author, batch.round, batch.timestamp, batch.committee_id, batch.block_height]
      );
    } catch (error) {
      logger.error('Error inserting batch:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getCommitteeSizeForRound(round: bigint): Promise<{ committee_size: number }> {
    const query = `
      SELECT COUNT(DISTINCT validator_address) AS committee_size
      FROM committee_participation
      WHERE round = $1
    `;
    const result = await this.pool.query(query, [round.toString()]);
    return { committee_size: parseInt(result.rows[0].committee_size) };
  }

  async getBatchesByCommitteeAndRound(committeeId: string, round: bigint): Promise<any[]> {
    const query = `
      SELECT * FROM batches
      WHERE committee_id = $1 AND round = $2
    `;
    const result = await this.pool.query(query, [committeeId, round.toString()]);
    return result.rows;
  }

  async validateValidatorParticipation(validatorAddress: string, committeeId: string, round: bigint): Promise<boolean> {
    const query = `
      SELECT COUNT(*) as count
      FROM batches
      WHERE author = $1 AND committee_id = $2 AND round = $3
    `;
    const result = await this.pool.query(query, [validatorAddress, committeeId, round.toString()]);
    return result.rows[0].count > 0;
  }

  async isDataSynchronized(): Promise<boolean> {
    const latestBlockHeight = await this.getLatestBlockHeight();
    const latestNetworkBlockHeight = await this.aleoSDKService.getLatestBlockHeight();
  
    return latestBlockHeight >= (latestNetworkBlockHeight ?? 0);
  }

  async getLatestBatchBlockHeight(): Promise<number> {
    const result = await this.pool.query('SELECT MAX(block_height) as max_height FROM batches');
    return result.rows[0].max_height || 0;
  }

  async insertSignatureParticipation(participation: {
    validator_address: string;
    batch_id: string;
    round: number;
    committee_id: string;
    block_height: number;
    timestamp: number;
  }): Promise<void> {
    const query = `
      INSERT INTO signature_participation (validator_address, batch_id, round, committee_id, block_height, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `;
    await this.pool.query(query, [
      participation.validator_address,
      participation.batch_id,
      participation.round,
      participation.committee_id,
      participation.block_height,
      participation.timestamp,
    ]);
  }

  async getSignatureParticipation(
    validatorAddress: string,
    startRound: bigint,
    endRound: bigint
  ): Promise<Array<{ committee_id: string; rounds: bigint[] }>> {
    const query = `
      SELECT committee_id, array_agg(DISTINCT round ORDER BY round) as rounds
      FROM signature_participation
      WHERE validator_address = $1 AND round BETWEEN $2 AND $3
      GROUP BY committee_id
    `;
    const result = await this.pool.query(query, [validatorAddress, startRound.toString(), endRound.toString()]);
    return result.rows.map((row: any) => ({
      committee_id: row.committee_id as string,
      rounds: (row.rounds as any[]).map((r: any) => BigInt(r))
    }));
  }

  async bulkInsertCommitteeMembers(members: any[]): Promise<void> {
    if (members.length === 0) return;
  
    // Veri tekrarlarını önlemek için Map kullanıyoruz
    const uniqueMembersMap = new Map<string, any>();
    for (const member of members) {
      const key = member.address;
      if (!uniqueMembersMap.has(key)) {
        uniqueMembersMap.set(key, member);
      } else {
        // Eğer aynı adres varsa, gerekli alanları güncelliyoruz
        const existingMember = uniqueMembersMap.get(key);
        existingMember.last_seen_block = Math.max(existingMember.last_seen_block, member.last_seen_block);
        existingMember.total_stake = member.total_stake;
        existingMember.is_open = member.is_open;
        existingMember.commission = member.commission;
        existingMember.is_active = member.is_active;
        existingMember.block_height = member.block_height;
      }
    }
    const uniqueMembers = Array.from(uniqueMembersMap.values());

    const values = uniqueMembers.map(m => [
      m.address,
      m.first_seen_block,
      m.last_seen_block,
      m.total_stake,
      m.is_open,
      m.commission,
      m.is_active,
      m.block_height
    ]);

    const query = format(`
      INSERT INTO committee_members (address, first_seen_block, last_seen_block, total_stake, is_open, commission, is_active, block_height)
      VALUES %L
      ON CONFLICT (address) DO UPDATE SET
        last_seen_block = EXCLUDED.last_seen_block,
        total_stake = EXCLUDED.total_stake,
        is_open = EXCLUDED.is_open,
        commission = EXCLUDED.commission,
        is_active = EXCLUDED.is_active,
        block_height = EXCLUDED.block_height
    `, values);

    await this.pool.query(query);
  }

  async bulkInsertBatchInfos(batchInfos: any[]): Promise<void> {
    if (batchInfos.length === 0) return;

    const uniqueBatchInfos = Array.from(new Map(batchInfos.map(item => [item.batch_id + '-' + item.round, item])).values());

    const values = uniqueBatchInfos.map(b => [
      b.batch_id,
      b.author,
      b.block_height,
      b.round,
      b.timestamp,
      b.committee_id || 'unknown' // Eğer committee_id null ise 'unknown' kullan
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

    await this.pool.query(query);
  }

  async bulkInsertCommitteeParticipations(participations: any[]): Promise<void> {
    if (participations.length === 0) return;

    const values = participations.map(p => [
      p.validator_address,
      p.committee_id,
      p.round,
      p.block_height,
      p.timestamp
    ]);

    const query = format(`
      INSERT INTO committee_participation (validator_address, committee_id, round, block_height, timestamp)
      VALUES %L
      ON CONFLICT DO NOTHING
    `, values);

    await this.pool.query(query);
  }

  async bulkInsertSignatureParticipations(signatures: any[]): Promise<void> {
    if (signatures.length === 0) return;

    const values = signatures.map(s => [
      s.validator_address,
      s.batch_id,
      s.round,
      s.committee_id,
      s.block_height,
      s.timestamp
    ]);

    const query = format(`
      INSERT INTO signature_participation (validator_address, batch_id, round, committee_id, block_height, timestamp)
      VALUES %L
      ON CONFLICT DO NOTHING
    `, values);

    await this.pool.query(query);
  }

  async getValidatorSignatures(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    const query = `
      SELECT * FROM signature_participation
      WHERE validator_address = $1 AND timestamp BETWEEN $2 AND $3
    `;
    const result = await this.pool.query(query, [validatorAddress, startTime, endTime]);
    return result.rows;
  }
}

export default SnarkOSDBService;