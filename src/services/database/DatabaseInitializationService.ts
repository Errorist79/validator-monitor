import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';
import { PoolClient } from 'pg';

export class DatabaseInitializationService extends BaseDBService {
  async checkDatabaseStructure(): Promise<boolean> {
    const client = await this.getClient();
    try {
      const tables = [
        'blocks', 'committee_members', 'committee_participation', 'batches',
        'uptime_snapshots', 'rewards', 'delegations', 'validator_status',
        'signature_participation', 'validators', 'metadata'
      ];
      const indexes = [
        'idx_blocks_round', 'idx_committee_participation_round',
        'idx_batches_round', 'idx_uptime_snapshots_end_round',
        'idx_rewards_address_height', 'idx_delegations_validator_address',
        'idx_validator_status_is_active', 'idx_signature_participation_validator',
        'idx_signature_participation_round', 'idx_validators_address',
        'idx_committee_participation_validator_timestamp',
        'idx_signature_participation_validator_timestamp',
        'idx_rewards_validator_timestamp'
      ];

      for (const table of tables) {
        if (!(await this.tableExists(client, table))) {
          logger.info(`Table ${table} does not exist`);
          return false;
        }
      }

      for (const index of indexes) {
        if (!(await this.indexExists(client, index))) {
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
    const client = await this.getClient();
    try {
      await client.query('BEGIN');

      await this.createTables(client);
      await this.createIndexes(client);

      await client.query('COMMIT');
      logger.info('Database schema initialized successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error("Error initializing database schema:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkAndUpdateSchema(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');

      const tables = ['blocks', 'committee_members', 'committee_participation', 'batches', 'uptime_snapshots', 'signature_participation', 'rewards', 'delegations', 'validator_status', 'validators', 'metadata'];
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

  private async tableExists(client: PoolClient, tableName: string): Promise<boolean> {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      )
    `, [tableName]);
    return result.rows[0].exists;
  }

  private async indexExists(client: PoolClient, indexName: string): Promise<boolean> {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = $1
      )
    `, [indexName]);
    return result.rows[0].exists;
  }

  private async createTables(client: PoolClient): Promise<void> {
    const createTableQueries = [
      `CREATE TABLE IF NOT EXISTS blocks (
        height BIGINT PRIMARY KEY,
        hash TEXT UNIQUE NOT NULL,
        previous_hash TEXT NOT NULL,
        round BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        transactions_count INTEGER NOT NULL,
        block_reward NUMERIC
      )`,
      `CREATE TABLE IF NOT EXISTS validators (
        address TEXT PRIMARY KEY,
        total_committees_participated BIGINT DEFAULT 0,
        total_signatures_successful BIGINT DEFAULT 0,
        total_rewards NUMERIC DEFAULT 0,
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS committee_members (
        address TEXT PRIMARY KEY,
        first_seen_block BIGINT NOT NULL,
        last_seen_block BIGINT,
        total_stake NUMERIC NOT NULL,
        is_open BOOLEAN NOT NULL,
        commission NUMERIC NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        block_height BIGINT NOT NULL,
        last_updated TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS committee_participation (
        id SERIAL PRIMARY KEY,
        validator_address TEXT REFERENCES committee_members(address),
        committee_id TEXT NOT NULL,
        round BIGINT NOT NULL,
        block_height BIGINT REFERENCES blocks(height),
        timestamp BIGINT NOT NULL,
        UNIQUE (validator_address, round)
      )`,
      `CREATE TABLE IF NOT EXISTS batches (
        batch_id TEXT NOT NULL,
        author TEXT NOT NULL,
        round BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        committee_id TEXT NOT NULL DEFAULT 'unknown',
        block_height BIGINT REFERENCES blocks(height),
        PRIMARY KEY (batch_id, round)
      )`,
      `CREATE TABLE IF NOT EXISTS uptime_snapshots (
        id SERIAL PRIMARY KEY,
        validator_address TEXT REFERENCES committee_members(address),
        start_round BIGINT NOT NULL,
        end_round BIGINT NOT NULL,
        total_rounds INTEGER NOT NULL,
        participated_rounds INTEGER NOT NULL,
        uptime_percentage NUMERIC(5,2) NOT NULL,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS rewards (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        reward NUMERIC NOT NULL,
        block_height BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        is_validator BOOLEAN NOT NULL,
        UNIQUE(address, block_height)
      )`,
      `CREATE TABLE IF NOT EXISTS delegations (
        id SERIAL PRIMARY KEY,
        delegator_address TEXT NOT NULL,
        validator_address TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        timestamp BIGINT NOT NULL,
        UNIQUE(delegator_address, validator_address)
      )`,
      `CREATE TABLE IF NOT EXISTS validator_status (
        address TEXT PRIMARY KEY,
        last_active_round BIGINT,
        consecutive_inactive_rounds INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS signature_participation (
        validator_address VARCHAR NOT NULL,
        batch_id VARCHAR NOT NULL,
        round BIGINT NOT NULL,
        committee_id VARCHAR NOT NULL,
        block_height BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        success BOOLEAN DEFAULT true,
        PRIMARY KEY (validator_address, batch_id, round)
      )`,
      `CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    ];

    for (const query of createTableQueries) {
      await client.query(query);
    }
  }

  private async createIndexes(client: PoolClient): Promise<void> {
    const createIndexQueries = [
      'CREATE INDEX IF NOT EXISTS idx_blocks_round ON blocks(round)',
      'CREATE INDEX IF NOT EXISTS idx_committee_participation_round ON committee_participation(round)',
      'CREATE INDEX IF NOT EXISTS idx_committee_participation_committee_round ON committee_participation(committee_id, round)',
      'CREATE INDEX IF NOT EXISTS idx_committee_participation_validator ON committee_participation(validator_address)',
      'CREATE INDEX IF NOT EXISTS idx_batches_round ON batches(round)',
      'CREATE INDEX IF NOT EXISTS idx_batches_committee_round ON batches(committee_id, round)',
      'CREATE INDEX IF NOT EXISTS idx_batches_author ON batches(author)',
      'CREATE INDEX IF NOT EXISTS idx_batches_author_committee_round ON batches(author, committee_id, round)',
      'CREATE INDEX IF NOT EXISTS idx_uptime_snapshots_end_round ON uptime_snapshots(end_round)',
      'CREATE INDEX IF NOT EXISTS idx_rewards_address_height ON rewards(address, block_height)',
      'CREATE INDEX IF NOT EXISTS idx_delegations_validator_address ON delegations(validator_address)',
      'CREATE INDEX IF NOT EXISTS idx_validator_status_is_active ON validator_status(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_signature_participation_validator ON signature_participation(validator_address)',
      'CREATE INDEX IF NOT EXISTS idx_signature_participation_round ON signature_participation(round)',
      'CREATE INDEX IF NOT EXISTS idx_validators_address ON validators(address)',
      'CREATE INDEX IF NOT EXISTS idx_committee_participation_validator_timestamp ON committee_participation(validator_address, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_signature_participation_validator_timestamp ON signature_participation(validator_address, timestamp, success)',
      'CREATE INDEX IF NOT EXISTS idx_rewards_validator_timestamp ON rewards(address, timestamp, is_validator)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_rewards_address_block_height ON rewards(address, block_height)'
    ];

    for (const query of createIndexQueries) {
      await client.query(query);
    }
  }

  private async checkAndUpdateTable(client: PoolClient, table: string): Promise<void> {
    const { rows } = await client.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);

    const currentColumns = new Map(rows.map((row: any) => [row.column_name, row]));

    const expectedColumns = this.getExpectedColumns(table);
    for (const [columnName, columnDef] of Object.entries(expectedColumns)) {
      if (!currentColumns.has(columnName)) {
        await client.query(`ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnDef}`);
        logger.info(`Added column ${columnName} to table ${table}`);
      } else {
        const currentColumn = currentColumns.get(columnName);
        if (currentColumn.data_type !== columnDef.split(' ')[0].toLowerCase()) {
          await client.query(`ALTER TABLE ${table} ALTER COLUMN ${columnName} TYPE ${columnDef.split(' ')[0]}`);
          logger.info(`Updated column ${columnName} type in table ${table}`);
        }
      }
    }
  }

  private getExpectedColumns(tableName: string): { [columnName: string]: string } {
    switch (tableName) {
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
          block_height: 'BIGINT NOT NULL',
          last_updated: 'TIMESTAMP NOT NULL DEFAULT NOW()'
        };
      case 'committee_participation':
        return {
          id: 'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
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
          committee_id: 'TEXT NOT NULL DEFAULT \'unknown\'',
          block_height: 'BIGINT REFERENCES blocks(height)'
        };
      case 'uptime_snapshots':
        return {
          id: 'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
          validator_address: 'TEXT REFERENCES committee_members(address)',
          start_round: 'BIGINT NOT NULL',
          end_round: 'BIGINT NOT NULL',
          total_rounds: 'INTEGER NOT NULL',
          participated_rounds: 'INTEGER NOT NULL',
          uptime_percentage: 'NUMERIC(5,2) NOT NULL',
          calculated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        };
      case 'rewards':
        return {
          id: 'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
          address: 'TEXT NOT NULL',
          reward: 'NUMERIC NOT NULL',
          block_height: 'BIGINT NOT NULL',
          timestamp: 'BIGINT NOT NULL',
          is_validator: 'BOOLEAN NOT NULL'
        };
      case 'delegations':
        return {
          id: 'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY',
          delegator_address: 'TEXT NOT NULL',
          validator_address: 'TEXT NOT NULL',
          amount: 'NUMERIC NOT NULL',
          timestamp: 'BIGINT NOT NULL'
        };
      case 'validator_status':
        return {
          address: 'TEXT PRIMARY KEY',
          last_active_round: 'BIGINT',
          consecutive_inactive_rounds: 'INT DEFAULT 0',
          is_active: 'BOOLEAN DEFAULT true',
          last_updated: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        };
      case 'signature_participation':
        return {
          validator_address: 'VARCHAR NOT NULL',
          batch_id: 'VARCHAR NOT NULL',
          round: 'BIGINT NOT NULL',
          committee_id: 'VARCHAR NOT NULL',
          block_height: 'BIGINT NOT NULL',
          timestamp: 'BIGINT NOT NULL',
          success: 'BOOLEAN NOT NULL DEFAULT true'
        };
      case 'validators':
        return {
          address: 'TEXT PRIMARY KEY',
          total_committees_participated: 'BIGINT DEFAULT 0',
          total_signatures_successful: 'BIGINT DEFAULT 0',
          total_rewards: 'NUMERIC DEFAULT 0',
          last_seen: 'TIMESTAMP WITH TIME ZONE DEFAULT NOW()'
        };
      case 'metadata':
        return {
          key: 'TEXT PRIMARY KEY',
          value: 'TEXT NOT NULL'
        };
      default:
        return {};
    }
  }
}
