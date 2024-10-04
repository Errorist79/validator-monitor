import Redis from 'ioredis';
import logger from '../utils/logger.js';

export class CacheService {
  private redis: Redis;

  constructor(private ttl: number, redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.redis.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Error getting cache for key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttl);
    } catch (error) {
      logger.error(`Error setting cache for key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error(`Error deleting cache for key ${key}:`, error);
    }
  }
}