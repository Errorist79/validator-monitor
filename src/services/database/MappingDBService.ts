import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';

export class MappingDBService extends BaseDBService {
  async updateBondedMap(bondedMap: Map<string, bigint>): Promise<void> {
    const client = await this.getClient();
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
    const client = await this.getClient();
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
}