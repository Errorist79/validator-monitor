import Redis from 'ioredis';
import logger from '../utils/logger.js';

interface ICacheStrategy {
  set(key: string, value: any, ttl?: number): Promise<void>;
  get(key: string): Promise<any>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
}

class RedisCacheStrategy implements ICacheStrategy {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serializedValue = JSON.stringify(value, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
    if (ttl) {
      await this.redis.setex(key, ttl, serializedValue);
    } else {
      await this.redis.set(key, serializedValue);
    }
  }

  async get(key: string): Promise<any> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value, (_, v) =>
      typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v
    ) : null;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async flush(): Promise<void> {
    await this.redis.flushall();
  }
}

export class CacheService {
  private strategy: ICacheStrategy;

  constructor(redisUrl: string) {
    this.strategy = new RedisCacheStrategy(redisUrl);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    await this.strategy.set(key, value, ttl);
  }

  async get(key: string): Promise<any> {
    return await this.strategy.get(key);
  }

  async del(key: string): Promise<void> {
    await this.strategy.del(key);
  }

  async flush(): Promise<void> {
    await this.strategy.flush();
  }

  async cacheCommittee(committee: any): Promise<void> {
    try {
      await this.set('latest_committee', committee, 60 * 60); // 1 saat TTL
    } catch (error) {
      logger.error('Error caching committee:', error);
    }
  }

  async getCachedCommittee(): Promise<any | null> {
    try {
      return await this.get('latest_committee');
    } catch (error) {
      logger.error('Error getting cached committee:', error);
      return null;
    }
  }
}