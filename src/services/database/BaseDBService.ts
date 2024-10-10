import pkg from 'pg';
const { Pool } = pkg;
import { config } from '../../config/index.js';
import logger from '../../utils/logger.js';

export class BaseDBService {
  protected static pool: pkg.Pool;

  constructor() {
    if (!BaseDBService.pool) {
      BaseDBService.pool = new Pool({
        connectionString: config.database.url,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      BaseDBService.pool.on('error', (err: Error) => {
        logger.error('Beklenmeyen havuz hatası', err);
      });
    }
  }

  async getClient(): Promise<pkg.PoolClient> {
    return await BaseDBService.pool.connect();
  }

  async executeQuery(query: string, params: any[] = []): Promise<any> {
    return BaseDBService.pool.query(query, params);
  }

  async query(sql: string, params?: any[]): Promise<{ rows: any[] }> {
    try {
      const result = await BaseDBService.pool.query(sql, params);
      return result;
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('Query error:', error.message);
        throw new Error(`Database query failed: ${error.message}`);
      }
      logger.error('Query error: An unknown error occurred');
      throw new Error('Database query failed: An unknown error occurred');
    }
  }
}