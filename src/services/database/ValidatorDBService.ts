import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';

interface Block {
  total_fees: string;
  timestamp: Date;
}

export class ValidatorDBService extends BaseDBService {
  async getValidators(): Promise<any[]> {
    const query = 'SELECT * FROM committee_members';
    const result = await this.query(query);
    logger.debug(`Retrieved ${result.rows.length} validators from the database`);
    return result.rows;
  }

  async getValidatorByAddress(address: string): Promise<any | null> {
    try {
      const result = await this.query('SELECT * FROM committee_members WHERE address = $1', [address]);
      return result.rows[0] || null;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`ValidatorDBService getValidatorByAddress error: ${error.message}`);
      }
      throw new Error('ValidatorDBService getValidatorByAddress error: An unknown error occurred');
    }
  }

  async updateValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    const query = `
      UPDATE committee_members 
      SET total_stake = $2, is_open = $3, commission = $4, last_updated = NOW()
      WHERE address = $1
    `;
    await this.query(query, [address, stake.toString(), isOpen, commission.toString()]);
  }

  async insertValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    const query = `
      INSERT INTO committee_members (address, total_stake, is_open, commission, first_seen_block, last_updated)
      VALUES ($1, $2, $3, $4, (SELECT MAX(height) FROM blocks), NOW())
    `;
    await this.query(query, [address, stake.toString(), isOpen, commission.toString()]);
  }

  async deactivateValidator(address: string): Promise<void> {
    const query = `
      UPDATE committee_members
      SET is_active = false, last_updated = NOW()
      WHERE address = $1
    `;
    await this.query(query, [address]);
  }

  async getActiveValidators(): Promise<string[]> {
    const query = 'SELECT address FROM committee_members WHERE is_active = true';
    const result = await this.query(query);
    logger.debug(`Retrieved ${result.rows.length} active validators`);
    return result.rows.map((row: { address: string }) => row.address);
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
    
    await this.query(query, [address, currentRound.toString(), 0, isActive]);
    logger.debug(`Updated status for validator ${address}: isActive=${isActive}, lastActiveRound=${currentRound}`);
  }

  async monitorValidatorPerformance(address: string, timeWindow: number): Promise<{
    blocksProduced: number,
    totalRewards: bigint,
    averageBlockTime: number
  }> {
    const endTime = Date.now();
    const startTime = endTime - timeWindow * 1000;

    const blocksQuery = `
      SELECT COUNT(*) as blocks_produced, AVG(timestamp - lag(timestamp) OVER (ORDER BY height)) as avg_block_time
      FROM blocks
      WHERE validator_address = $1 AND timestamp BETWEEN $2 AND $3
    `;
    const rewardsQuery = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM validator_rewards
      WHERE validator_address = $1 AND timestamp BETWEEN $2 AND $3
    `;

    const [blocksResult, rewardsResult] = await Promise.all([
      this.query(blocksQuery, [address, startTime, endTime]),
      this.query(rewardsQuery, [address, startTime, endTime])
    ]);

    return {
      blocksProduced: parseInt(blocksResult.rows[0].blocks_produced),
      totalRewards: BigInt(rewardsResult.rows[0].total_rewards || 0),
      averageBlockTime: parseFloat(blocksResult.rows[0].avg_block_time || 0)
    };
  }

  async updateValidatorBlockProduction(address: string, blockReward: bigint): Promise<void> {
    try {
      await this.query(
        'UPDATE validators SET total_blocks_produced = total_blocks_produced + 1, total_rewards = total_rewards + $1, last_seen = NOW() WHERE address = $2',
        [blockReward.toString(), address]
      );
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`ValidatorDBService updateValidatorBlockProduction error: ${error.message}`);
      }
      throw new Error('ValidatorDBService updateValidatorBlockProduction error: An unknown error occurred');
    }
  }

  async getValidatorRewards(validatorAddress: string, timeFrame: number): Promise<string> {
    try {
      const result = await this.query(`
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

  async insertOrUpdateValidator(address: string, stake: bigint): Promise<void> {
    try {
      await this.query(`
        INSERT INTO validators (address, stake, is_active, bonded, last_seen)
        VALUES ($1, $2, true, $2, NOW())
        ON CONFLICT (address) DO UPDATE SET
          stake = $2,
          is_active = true,
          bonded = $2,
          last_seen = NOW()
      `, [address, stake.toString()]);
    } catch (error) {
      logger.error("Error inserting or updating validator:", error);
      throw error;
    }
  }

  async getValidatorBlockCountInRange(validatorAddress: string, startHeight: number, endHeight: number): Promise<number> {
    try {
      const result = await this.query(`
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

  async getTotalValidatorsCount(): Promise<number> {
    try {
      const result = await this.query(`
        SELECT COUNT(*) as validator_count
        FROM committee_members
        WHERE is_active = true
      `);
      return parseInt(result.rows[0].validator_count);
    } catch (error) {
      logger.error('Error getting total validators count:', error);
      throw error;
    }
  }

  async getDelegators(validatorAddress: string): Promise<any[]> {
    const query = `
      SELECT d.delegator_address, d.amount
      FROM delegations d
      WHERE d.validator_address = $1
    `;
    const result = await this.query(query, [validatorAddress]);
    return result.rows;
  }
}