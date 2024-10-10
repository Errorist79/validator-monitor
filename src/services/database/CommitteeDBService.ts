import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';
import { PoolClient } from 'pg';
import format from 'pg-format';

export class CommitteeDBService extends BaseDBService {
  async insertOrUpdateCommitteeMember(
    address: string, 
    blockHeight: number, 
    total_stake: bigint, 
    isOpen: boolean, 
    commission: bigint
  ): Promise<void> {
    const query = `
      INSERT INTO committee_members (address, first_seen_block, last_seen_block, total_stake, is_open, commission, last_updated)
      VALUES ($1, $2, $2, $3, $4, $5, NOW())
      ON CONFLICT (address) DO UPDATE SET 
      last_seen_block = $2,
      total_stake = $3,
      is_open = $4,
      commission = $5,
      last_updated = NOW()
    `;
    await this.query(query, [address, blockHeight, total_stake.toString(), isOpen, commission.toString()]);
  }

  async insertCommitteeParticipation(participation: {
    validator_address: string;
    committee_id: string;
    round: number;
    block_height: number;
    timestamp: number;
  }): Promise<void> {
    const query = `
      INSERT INTO committee_participation (validator_address, committee_id, round, block_height, timestamp)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (validator_address, round) DO NOTHING
    `;
    await this.query(query, [
      participation.validator_address,
      participation.committee_id,
      participation.round,
      participation.block_height,
      participation.timestamp
    ]);
  }

  async getCommitteeSizeForRound(round: bigint): Promise<{ committee_size: number }> {
    const query = `
      SELECT COUNT(DISTINCT validator_address) AS committee_size
      FROM committee_participation
      WHERE round = $1
    `;
    const result = await this.query(query, [round.toString()]);
    return { committee_size: parseInt(result.rows[0].committee_size) };
  }

  async getCommitteeEntriesForValidator(validatorAddress: string, startTimestamp: number, endTimestamp: number): Promise<any[]> {
    const query = `
      SELECT cp.id, cp.validator_address, cp.committee_id, cp.round, cp.block_height, cp.timestamp
      FROM committee_participation cp
      JOIN committee_members cm ON cp.validator_address = cm.address
      WHERE cm.address = $1 AND cp.timestamp BETWEEN $2 AND $3
      ORDER BY cp.timestamp
    `;
    const result = await this.query(query, [validatorAddress, startTimestamp, endTimestamp]);
    return result.rows;
  }

  async insertCommitteeEntry(validatorAddress: string, startHeight: number, endHeight?: number): Promise<void> {
    try {
      await this.query(`
        INSERT INTO committee_entries (validator_address, start_height, end_height)
        VALUES ($1, $2, $3)
        ON CONFLICT (validator_address, start_height) DO UPDATE SET
          end_height = EXCLUDED.end_height
      `, [validatorAddress, startHeight, endHeight]);
    } catch (error) {
      logger.error("Error inserting committee entry:", error);
      throw error;
    }
  }

  async getEarliestValidatorRound(validatorAddress: string): Promise<bigint | null> {
    const query = `
      SELECT MIN(round) as earliest_round
      FROM committee_participation
      WHERE validator_address = $1
    `;
    const result = await this.query(query, [validatorAddress]);
    return result.rows[0]?.earliest_round ? BigInt(result.rows[0].earliest_round) : null;
  }

  async getTotalCommittees(startRound: bigint, endRound: bigint): Promise<{ committee_id: string, rounds: bigint[] }[]> {
    const query = `
      SELECT committee_id, ARRAY_AGG(DISTINCT round) as rounds
      FROM batches
      WHERE round BETWEEN $1 AND $2
      GROUP BY committee_id
    `;
    const result = await this.query(query, [startRound.toString(), endRound.toString()]);
    return result.rows.map(row => ({
      committee_id: row.committee_id,
      rounds: row.rounds.map((round: string) => BigInt(round))
    }));
  }

  async getValidatorParticipation(validatorAddress: string, startRound: bigint, endRound: bigint): Promise<any[]> {
    const query = `
      SELECT *
      FROM committee_participation
      WHERE validator_address = $1 AND round BETWEEN $2 AND $3
      ORDER BY round
    `;
    const result = await this.query(query, [validatorAddress, startRound.toString(), endRound.toString()]);
    return result.rows;
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
    const result = await this.query(query, [validatorAddress, startRound.toString(), endRound.toString()]);
    return result.rows.map((row: any) => ({
      committee_id: row.committee_id as string,
      rounds: (row.rounds as any[]).map((r: any) => BigInt(r))
    }));
  }


  async checkCommitteesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    const query = 'SELECT COUNT(*) as count FROM committee_members WHERE block_height BETWEEN $1 AND $2';
    const result = await this.query(query, [startHeight, endHeight]);
    return parseInt(result.rows[0].count) > 0;
  }

  async checkSignaturesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    const query = 'SELECT COUNT(*) as count FROM signature_participation WHERE block_height BETWEEN $1 AND $2';
    const result = await this.query(query, [startHeight, endHeight]);
    return parseInt(result.rows[0].count) > 0;
  }

  async bulkInsertCommitteeMembers(members: any[], client?: PoolClient): Promise<void> {
    if (members.length === 0) return;
  
    const uniqueMembersMap = new Map<string, any>();
    for (const member of members) {
      const key = member.address;
      if (!uniqueMembersMap.has(key)) {
        uniqueMembersMap.set(key, member);
      } else {
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
      WHERE committee_members.block_height < EXCLUDED.block_height
    `, values);

    if (client) {
      await client.query(query);
    } else {
      await this.query(query);
    }
  }

  async bulkInsertCommitteeParticipations(participations: any[], client?: PoolClient): Promise<void> {
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

    if (client) {
      await client.query(query);
    } else {
      await this.query(query);
    }
  }

  async bulkInsertSignatureParticipations(signatures: any[], client?: PoolClient): Promise<void> {
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

    if (client) {
      await client.query(query);
    } else {
      await this.query(query);
    }
  }

  async getValidatorSignatures(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    const query = `
      SELECT * FROM signature_participation
      WHERE validator_address = $1 AND timestamp BETWEEN $2 AND $3
    `;
    const result = await this.query(query, [validatorAddress, startTime, endTime]);
    return result.rows;
  }
}