import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';

export class RewardsDBService extends BaseDBService {
  async updateRewards(
    address: string, 
    reward: bigint, 
    blockHeight: bigint, 
    timestamp: bigint, 
    isValidator: boolean
  ): Promise<void> {
    logger.debug(`Updating rewards in DB: address=${address}, reward=${reward}, blockHeight=${blockHeight}, timestamp=${timestamp}, isValidator=${isValidator}`);
    const query = `
      INSERT INTO rewards (address, reward, block_height, timestamp, is_validator)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (address, block_height)
      DO UPDATE SET reward = EXCLUDED.reward, timestamp = EXCLUDED.timestamp
    `;
    try {
      await this.query(query, [address, reward.toString(), blockHeight.toString(), timestamp.toString(), isValidator]);
      logger.debug(`Successfully updated rewards in DB`);
    } catch (error) {
      logger.error(`Error updating rewards in DB:`, error);
      throw error;
    }
  }

  async getRewardsInRange(address: string, startBlock: number, endBlock: number, isValidator: boolean): Promise<bigint> {
    const query = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM rewards
      WHERE address = $1 AND block_height BETWEEN $2 AND $3 AND is_validator = $4
    `;
    const result = await this.query(query, [address, startBlock, endBlock, isValidator]);
    return BigInt(result.rows[0].total_rewards || 0);
  }

  async getRewardsInTimeRange(address: string, startTime: number, endTime: number, isValidator: boolean): Promise<Array<{amount: bigint, timestamp: number}>> {
    const query = `
      SELECT r.reward, r.timestamp
      FROM rewards r
      WHERE r.address = $1 
      AND r.timestamp BETWEEN $2 AND $3 
      AND r.is_validator = $4
      ORDER BY r.timestamp ASC
    `;
    
    try {
      logger.debug(`Querying rewards with params: address=${address}, startTime=${startTime}, endTime=${endTime}, isValidator=${isValidator}`);
      
      const result = await this.query(query, [address, startTime, endTime, isValidator]);
      
      logger.debug(`Found ${result.rows.length} reward records`);
      
      // BigInt serileştirme hatasını önlemek için toString() kullanıyoruz
      if (result.rows.length > 0) {
        logger.debug(`Sample reward record: reward=${result.rows[0].reward}, timestamp=${result.rows[0].timestamp}`);
      }
      
      return result.rows.map((row: { reward: string; timestamp: number }) => {
        const amount = BigInt(row.reward || '0');
        return {
          amount,
          timestamp: row.timestamp
        };
      });
    } catch (error) {
      logger.error('Error getting rewards in time range:', error);
      throw error;
    }
  }

  async bulkUpdateRewards(updates: Array<{
    address: string;
    reward: bigint;
    blockHeight: bigint;
    timestamp: bigint;
    isValidator: boolean;
  }>): Promise<void> {
    if (updates.length === 0) return;

    // Batch size'ı belirle
    const BATCH_SIZE = 1000;
    const batches = [];
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batchUpdates = updates.slice(i, i + BATCH_SIZE);
      const query = `
        INSERT INTO rewards (address, reward, block_height, timestamp, is_validator)
        VALUES ${batchUpdates.map((_, idx) => 
          `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
        ).join(', ')}
        ON CONFLICT (address, block_height) 
        DO UPDATE SET 
          reward = EXCLUDED.reward,
          timestamp = EXCLUDED.timestamp,
          is_validator = EXCLUDED.is_validator;
      `;

      const values = batchUpdates.flatMap(u => [
        u.address,
        u.reward.toString(),
        u.blockHeight.toString(),
        u.timestamp.toString(),
        u.isValidator
      ]);

      batches.push(this.query(query, values));
    }

    try {
      await Promise.all(batches);
      logger.debug(`Successfully updated ${updates.length} reward entries in ${batches.length} batches`);
    } catch (error) {
      logger.error('Error in bulkUpdateRewards:', error);
      throw error;
    }
  }

  async getDelegators(validatorAddress: string): Promise<Array<{ address: string; amount: bigint }>> {
    const query = 'SELECT delegator_address, amount FROM delegations WHERE validator_address = $1';
    const result = await this.query(query, [validatorAddress]);
    return result.rows.map(row => ({
      address: row.delegator_address,
      amount: BigInt(row.amount)
    }));
  }

  async getLatestProcessedBlockHeight(): Promise<number | null> {
    const query = 'SELECT value FROM metadata WHERE key = \'latest_processed_block_height\' LIMIT 1';
    const result = await this.query(query);
    return result.rows.length > 0 ? Number(result.rows[0].value) : null;
  }

  async updateLatestProcessedBlockHeight(blockHeight: number): Promise<void> {
    const query = `
      INSERT INTO metadata (key, value)
      VALUES ('latest_processed_block_height', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
    await this.query(query, [blockHeight.toString()]);
  }

  async getBlocksWithRewards(startBlock: number, endBlock: number): Promise<Map<number, {
    reward: bigint;
    timestamp: number;
  }>> {
    const query = `
      SELECT height, block_reward, timestamp 
      FROM blocks 
      WHERE height BETWEEN $1 AND $2 
      AND block_reward IS NOT NULL
      ORDER BY height ASC
    `;
    
    const result = await this.query(query, [startBlock, endBlock]);
    return new Map(result.rows.map(row => [
      row.height,
      {
        reward: BigInt(row.block_reward),
        timestamp: row.timestamp
      }
    ]));
  }
}
