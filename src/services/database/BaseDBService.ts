import pkg, { QueryResult } from 'pg';
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

  async query(text: string, params: any[] = []): Promise<QueryResult> {
    const client = await BaseDBService.pool.connect();
    try {
      // BigInt değerlerini string'e dönüştür
      const serializedParams = params.map(param => 
        typeof param === 'bigint' ? param.toString() : param
      );
      const result = await client.query(text, serializedParams);
      return this.convertResultToBigInt(result);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('Database query failed:', error);
        logger.error('Query:', text);
        logger.error('Params:', JSON.stringify(params, (_, v) => typeof v === 'bigint' ? v.toString() : v));
        throw new Error(`Database query failed: ${error.message}`);
      } else {
        logger.error('Database query failed with unknown error:', error);
        throw new Error('Database query failed with unknown error');
      }
    } finally {
      client.release();
    }
  }

  private convertResultToBigInt(result: QueryResult): QueryResult {
    if (result.rows) {
      result.rows = result.rows.map(row => this.convertRowToBigInt(row));
    }
    return result;
  }

  private convertRowToBigInt(row: any): any {
    const convertedRow: any = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && /^\d+$/.test(value)) {
        convertedRow[key] = BigInt(value);
      } else {
        convertedRow[key] = value;
      }
    }
    return convertedRow;
  }

  protected convertBigIntToString(obj: any): any {
    if (typeof obj === 'bigint') {
      return obj.toString();
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.convertBigIntToString(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const newObj: any = {};
      for (const key in obj) {
        newObj[key] = this.convertBigIntToString(obj[key]);
      }
      return newObj;
    }
    return obj;
  }
}
