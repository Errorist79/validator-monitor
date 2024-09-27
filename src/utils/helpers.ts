import logger from '../utils/logger.js';

export function parseIntSafe(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
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