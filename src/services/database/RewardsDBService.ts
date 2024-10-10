import { BaseDBService } from './BaseDBService.js';
import logger from '../../utils/logger.js';

export class RewardsDBService extends BaseDBService {
  async updateBlockReward(blockHash: string, reward: bigint): Promise<void> {
    const query = 'UPDATE blocks SET block_reward = $1 WHERE hash = $2';
    await this.query(query, [reward.toString(), blockHash]);
  }

  async updateValidatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    const query = `
      INSERT INTO validator_rewards (validator_address, reward, block_height)
      VALUES ($1, $2, $3)
      ON CONFLICT (validator_address, block_height)
      DO UPDATE SET reward = EXCLUDED.reward
    `;
    await this.query(query, [address, reward.toString(), blockHeight.toString()]);
  }

  async updateDelegatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    const query = `
      INSERT INTO delegator_rewards (delegator_address, reward, block_height)
      VALUES ($1, $2, $3)
      ON CONFLICT (delegator_address, block_height)
      DO UPDATE SET reward = EXCLUDED.reward
    `;
    await this.query(query, [address, reward.toString(), blockHeight.toString()]);
  }

  async getValidatorRewardsInRange(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    const query = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM validator_rewards
      WHERE validator_address = $1 AND block_height BETWEEN $2 AND $3
    `;
    const result = await this.query(query, [validatorAddress, startBlock, endBlock]);
    return BigInt(result.rows[0].total_rewards || 0);
  }

  async getDelegatorRewardsInRange(delegatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    const query = `
      SELECT SUM(reward::numeric) as total_rewards
      FROM delegator_rewards
      WHERE delegator_address = $1 AND block_height BETWEEN $2 AND $3
    `;
    const result = await this.query(query, [delegatorAddress, startBlock, endBlock]);
    return BigInt(result.rows[0].total_rewards || 0);
  }
}