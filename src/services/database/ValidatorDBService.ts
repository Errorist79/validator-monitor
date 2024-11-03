import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';
import { serializeBigInt } from '../../utils/bigIntSerializer.js';
import { RewardsService } from '../RewardsService.js';
import { SnarkOSDBService } from '../SnarkOSDBService.js';

export class ValidatorDBService extends BaseDBService {
  constructor(
    private rewardsService: RewardsService,
    private snarkOSDBService: SnarkOSDBService
  ) {
    super();
  }

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

  async getActiveValidators(): Promise<{ address: string; stake: bigint; isOpen: boolean; commission: number }[]> {
    try {
      const query = `
        SELECT address, total_stake, is_open, commission
        FROM committee_members
        WHERE is_active = true
      `;
      const result = await this.query(query);
      logger.debug(`Retrieved ${result.rows.length} active validators`);
      return result.rows.map((row: { address: string; total_stake: string; is_open: boolean; commission: string }) => ({
        address: row.address,
        stake: BigInt(row.total_stake),
        isOpen: row.is_open,
        commission: parseFloat(row.commission)
      }));
    } catch (error) {
      logger.error('Aktif validatörleri alırken hata oluştu:', error);
      throw error;
    }
  }

  async getInactiveValidators(): Promise<string[]> {
    const query = `
        SELECT address, total_stake, is_open, commission
        FROM committee_members
        WHERE is_active = false
      `;
    const result = await this.query(query);
    logger.debug(`Retrieved ${result.rows.length} inactive validators`);
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

  private async queryPerformance(address: string, startTime: number, endTime: number): Promise<{
    committeeParticipations: number,
    totalSignatures: number,
    totalBatchesProduced: number,
    totalRewards: string,
    selfStakeRewards: string,
    commissionRewards: string,
    delegatorRewards: string
  }> {
    logger.debug(`Querying performance for ${address} from ${startTime} to ${endTime}`);
    
    // Ödül hesaplama işlemini çağır
    await this.calculateRewardsForTimeRange(address, startTime, endTime);
    
    const query = `
      WITH committee_participations AS (
        SELECT COUNT(DISTINCT committee_id) as participations
        FROM signature_participation
        WHERE validator_address = $1 AND timestamp >= $2 AND timestamp <= $3
      ), signature_count AS (
        SELECT COUNT(*) as total_signatures
        FROM signature_participation
        WHERE validator_address = $1 AND timestamp >= $2 AND timestamp <= $3
      ), batch_count AS (
        SELECT COUNT(*) as total_batches
        FROM batches
        WHERE author = $1 AND timestamp >= $2 AND timestamp <= $3
      ), rewards_sum AS (
        SELECT 
          COALESCE(SUM(reward::numeric), 0)::text as total_rewards,
          COALESCE(SUM(self_stake_reward::numeric), 0)::text as self_stake_rewards,
          COALESCE(SUM(commission_reward::numeric), 0)::text as commission_rewards,
          COALESCE(SUM(delegator_reward::numeric), 0)::text as delegator_rewards
        FROM rewards
        WHERE address = $1 
        AND timestamp BETWEEN $2 AND $3 
        AND is_validator = true
      )
      SELECT 
        committee_participations.participations as committee_participations,
        signature_count.total_signatures as total_signatures,
        batch_count.total_batches as total_batches_produced,
        rewards_sum.total_rewards,
        rewards_sum.self_stake_rewards,
        rewards_sum.commission_rewards,
        rewards_sum.delegator_rewards
      FROM committee_participations, signature_count, batch_count, rewards_sum
    `;

    try {
      const result = await this.query(query, [address, startTime, endTime]);
      
      return {
        committeeParticipations: parseInt(result.rows[0].committee_participations) || 0,
        totalSignatures: parseInt(result.rows[0].total_signatures) || 0,
        totalBatchesProduced: parseInt(result.rows[0].total_batches_produced) || 0,
        totalRewards: result.rows[0].total_rewards || '0',
        selfStakeRewards: result.rows[0].self_stake_rewards || '0',
        commissionRewards: result.rows[0].commission_rewards || '0',
        delegatorRewards: result.rows[0].delegator_rewards || '0'
      };
    } catch (error) {
      logger.error(`Error in queryPerformance for ${address}:`, error);
      throw error;
    }
  }

  private async calculateRewardsForTimeRange(address: string, startTime: number, endTime: number): Promise<void> {
    logger.debug(`Calculating rewards for ${address} from ${startTime} to ${endTime}`);
    
    try {
      await this.rewardsService.calculateRewardsForTimeRange(address, startTime, endTime);
      
      logger.debug(`Rewards calculation completed for ${address}`);
    } catch (error) {
      logger.error(`Error calculating rewards for ${address}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Hata fırlatmak yerine sadece log'luyoruz, böylece performans sorgusu devam edebilir
    }
  }

  async updateValidatorParticipation(
    address: string,
    committeeParticipation: boolean,
    signatureSuccess: boolean,
    reward: bigint
  ): Promise<void> {
    const query = `
      INSERT INTO validators (
        address, 
        total_committees_participated, 
        total_signatures_successful, 
        total_rewards, 
        last_seen
      ) VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (address) DO UPDATE SET
        total_committees_participated = validators.total_committees_participated + $2,
        total_signatures_successful = validators.total_signatures_successful + $3,
        total_rewards = validators.total_rewards + $4,
        last_seen = NOW()
    `;
    try {
      await this.query(query, [
        address,
        committeeParticipation ? 1 : 0,
        signatureSuccess ? 1 : 0,
        reward.toString()
      ]);
      logger.debug(`Updated participation for validator ${address}`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`ValidatorDBService updateValidatorParticipation error: ${error.message}`);
      }
      throw new Error('ValidatorDBService updateValidatorParticipation error: An unknown error occurred');
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

  async getTotalValidatorStake(address: string): Promise<bigint> {
    try {
      const query = 'SELECT total_stake FROM committee_members WHERE address = $1';
      const result = await this.query(query, [address]);
      if (result.rows.length > 0 && result.rows[0].total_stake !== null) {
        return BigInt(result.rows[0].total_stake);
      } else {
        logger.warn(`No stake found for validator ${address}`);
        return BigInt(0);
      }
    } catch (error) {
      logger.error(`Error getting total stake for validator ${address}:`, error);
      throw error;
    }
  }

  async getValidatorInfo(address: string): Promise<{ totalStake: bigint; commissionRate: number }> {
    const query = 'SELECT stake, commission_rate FROM validators WHERE address = $1';
    const result = await this.query(query, [address]);
    if (result.rows.length === 0) {
      throw new Error(`Validator not found: ${address}`);
    }
    return {
      totalStake: BigInt(result.rows[0].stake),
      commissionRate: result.rows[0].commission_rate
    };
  }

  async getDelegators(validatorAddress: string): Promise<Array<{ address: string; amount: bigint }>> {
    const query = 'SELECT delegator_address, amount FROM delegations WHERE validator_address = $1';
    const result = await this.query(query, [validatorAddress]);
    return result.rows.map((row: { delegator_address: string; amount: string }) => ({
      address: row.delegator_address,
      amount: BigInt(row.amount)
    }));
  }

  async monitorValidatorPerformance(address: string, timeWindow: number): Promise<any> {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - timeWindow;
    
    try {
      logger.debug(`Monitoring performance for validator ${address}`);
      logger.debug(`Time range: ${new Date(startTime * 1000)} to ${new Date(endTime * 1000)}`);
      
      let result = await this.queryPerformance(address, startTime, endTime);
      
      if (result.committeeParticipations === 0 && result.totalSignatures === 0) {
        const extendedStartTime = startTime - timeWindow;
        logger.debug(`No recent activity found, extending time range to ${new Date(extendedStartTime * 1000)}`);
        result = await this.queryPerformance(address, extendedStartTime, endTime);
      }

      // Ödülleri hesapla
      const totalRewards = await this.rewardsService.calculateRewardsForTimeRange(address, startTime, endTime);
      logger.debug(`Total rewards from RewardsService: ${totalRewards.toString()}`);
      
      // Performans metriklerini hesapla
      const signatureRate = result.committeeParticipations > 0 
        ? result.totalSignatures / result.committeeParticipations 
        : 0;
      
      const batchRate = result.committeeParticipations > 0 
        ? result.totalBatchesProduced / result.committeeParticipations 
        : 0;
      
      const performanceScore = Math.min(((signatureRate + batchRate) / 2) * 100, 100);

      // Aleo rewards'ı 10^6 decimal ile formatla
      const formatRewards = (amount: bigint): string => (Number(amount) / 1_000_000).toFixed(6);

      const serializedResult = {
        committeeParticipations: result.committeeParticipations,
        totalSignatures: result.totalSignatures,
        totalBatchesProduced: result.totalBatchesProduced,
        rewards: {
          total: formatRewards(BigInt(result.totalRewards)),
          selfStake: formatRewards(BigInt(result.selfStakeRewards)),
          commission: formatRewards(BigInt(result.commissionRewards)),
          delegators: formatRewards(BigInt(result.delegatorRewards))
        },
        rawRewards: {
          total: totalRewards.toString(),
          selfStake: result.selfStakeRewards,
          commission: result.commissionRewards,
          delegators: result.delegatorRewards
        },
        performanceScore: Number(performanceScore.toFixed(2))
      };

      logger.debug(`Final performance metrics for ${address}:`, serializedResult);
      return serializedResult;
    } catch (error) {
      logger.error(`Error in monitorValidatorPerformance for ${address}:`, error);
      throw error;
    }
  }
}
