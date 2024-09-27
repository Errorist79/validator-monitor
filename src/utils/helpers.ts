import logger from '../utils/logger.js';
import { APIRatification } from '../database/models/Block.js';

export function parseIntSafe(value: string | number): number {
  if (typeof value === 'number') return value;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

export function getBigIntFromString(value: string): bigint {
  try {
    return BigInt(value);
  } catch (error) {
    logger.error(`Error converting string to BigInt: ${value}`, error);
    return BigInt(0);
  }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function findBlockReward(ratifications: APIRatification[]): bigint | undefined {
  const blockReward = ratifications.find(r => r.type === 'block_reward');
  return blockReward && blockReward.amount !== undefined ? BigInt(blockReward.amount) : undefined;
}