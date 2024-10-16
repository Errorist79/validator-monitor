import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';
import { UptimeSnapshotAttributes } from '../../database/models/UptimeSnapshot.js';

export class UptimeDBService extends BaseDBService {
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
    try {
      await this.query(query, [
        address,
        startRound.toString(),
        endRound.toString(),
        totalRounds.toString(),
        participatedRounds.toString(),
        uptimePercentage
      ]);
      logger.debug(`Updated uptime for validator ${address}: ${uptimePercentage}%`);
    } catch (error) {
      logger.error(`Error updating uptime for validator ${address}:`, error);
      throw error;
    }
  }
  async getLatestUptimeSnapshot(validatorAddress: string): Promise<UptimeSnapshotAttributes | null> {
    const query = `
      SELECT *
      FROM uptime_snapshots
      WHERE validator_address = $1
      ORDER BY calculated_at DESC
      LIMIT 1
    `;
    try {
      const result = await this.query(query, [validatorAddress]);
      if (result.rows.length === 0) {
        return null;
      }
      const snapshot = result.rows[0];
      return {
        id: snapshot.id,
        validator_address: snapshot.validator_address,
        start_round: BigInt(snapshot.start_round),
        end_round: BigInt(snapshot.end_round),
        total_rounds: Number(snapshot.total_rounds),
        participated_rounds: Number(snapshot.participated_rounds),
        uptime_percentage: snapshot.uptime_percentage,
        calculated_at: snapshot.calculated_at
      };
    } catch (error) {
      logger.error(`En son uptime snapshot alınırken hata oluştu (validator: ${validatorAddress}):`, error);
      throw error;
    }
  }

  async getLastUptimeSnapshot(address: string): Promise<any | null> {
    const query = `
      SELECT * FROM uptime_snapshots
      WHERE validator_address = $1
      ORDER BY end_round DESC
      LIMIT 1
    `;
    try {
      const result = await this.query(query, [address]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error fetching last uptime snapshot for validator ${address}:`, error);
      throw error;
    }
  }

  async insertUptimeSnapshot(uptimeSnapshot: Omit<UptimeSnapshotAttributes, 'id'>): Promise<void> {
    const query = `
      INSERT INTO uptime_snapshots 
      (validator_address, start_round, end_round, total_rounds, participated_rounds, uptime_percentage, calculated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    await this.query(query, [
      uptimeSnapshot.validator_address,
      uptimeSnapshot.start_round.toString(),
      uptimeSnapshot.end_round.toString(),
      uptimeSnapshot.total_rounds.toString(),
      uptimeSnapshot.participated_rounds.toString(),
      uptimeSnapshot.uptime_percentage,
      uptimeSnapshot.calculated_at
    ]);
  }

  async getValidatorUptime(validatorAddress: string): Promise<number> {
    const query = `
      SELECT uptime_percentage
      FROM uptime_snapshots
      WHERE validator_address = $1
      ORDER BY calculated_at DESC
      LIMIT 1
    `;
    const result = await this.query(query, [validatorAddress]);
    return result.rows[0]?.uptime_percentage || 0;
  }
}
