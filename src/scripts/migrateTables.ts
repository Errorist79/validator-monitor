import { Pool } from 'pg';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

const pool = new Pool({
  connectionString: config.database.url,
});

async function migrateTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Backup existing data
    await client.query('CREATE TEMP TABLE batches_backup AS SELECT * FROM batches');
    await client.query('CREATE TEMP TABLE signature_participation_backup AS SELECT * FROM signature_participation');

    // Drop existing tables
    await client.query('DROP TABLE IF EXISTS batches');
    await client.query('DROP TABLE IF EXISTS signature_participation');

    // Recreate tables with new schema
    await client.query(`
      CREATE TABLE batches (
        id SERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL,
        author TEXT NOT NULL,
        round BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        committee_id TEXT NOT NULL DEFAULT 'unknown',
        block_height BIGINT REFERENCES blocks(height),
        UNIQUE (batch_id, round)
      );

      CREATE TABLE signature_participation (
        id SERIAL PRIMARY KEY,
        validator_address VARCHAR NOT NULL,
        batch_id VARCHAR NOT NULL,
        round BIGINT NOT NULL,
        committee_id VARCHAR NOT NULL,
        block_height BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        UNIQUE (validator_address, batch_id, round)
      );
    `);

    // Restore data
    await client.query('INSERT INTO batches (batch_id, author, round, timestamp, committee_id, block_height) SELECT batch_id, author, round, timestamp, committee_id, block_height FROM batches_backup');
    await client.query('INSERT INTO signature_participation (validator_address, batch_id, round, committee_id, block_height, timestamp) SELECT validator_address, batch_id, round, committee_id, block_height, timestamp FROM signature_participation_backup');

    // Recreate indexes
    await client.query(`
      CREATE INDEX idx_batches_round ON batches(round);
      CREATE INDEX idx_batches_committee_round ON batches(committee_id, round);
      CREATE INDEX idx_batches_author ON batches(author);
      CREATE INDEX idx_batches_author_committee_round ON batches(author, committee_id, round);
      CREATE INDEX idx_signature_participation_validator ON signature_participation (validator_address);
      CREATE INDEX idx_signature_participation_round ON signature_participation (round);
    `);

    await client.query('COMMIT');
    logger.info('Table migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error during table migration:', error);
    throw error;
  } finally {
    client.release();
  }
}

migrateTables().catch(console.error);