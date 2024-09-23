import NodeCache from 'node-cache';
import Redis from 'ioredis';
import logger from '../utils/logger.js';

interface ICacheStrategy {
  set(key: string, value: any, ttl?: number): void | Promise<void>;
  get(key: string): any | Promise<any>;
  del(key: string): void | Promise<void>;
  flush(): void | Promise<void>;
}

class NodeCacheStrategy implements ICacheStrategy {
  private cache: NodeCache;

  constructor(ttlSeconds: number) {
    this.cache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: ttlSeconds * 0.2 });
  }
  set(key: string, value: any, ttl?: number): void {
    if (ttl !== undefined) {
      this.cache.set(key, value, ttl);
    } else {
      this.cache.set(key, value);
    }
  }

  get(key: string): any {
    return this.cache.get(key);
  }

  del(key: string): void {
    this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
  }
}

class RedisCacheStrategy implements ICacheStrategy {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (ttl) {
      await this.redis.setex(key, ttl, serializedValue);
    } else {
      await this.redis.set(key, serializedValue);
    }
  }

  async get(key: string): Promise<any> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async flush(): Promise<void> {
    await this.redis.flushall();
  }
}

export class CacheService {
  private strategies: ICacheStrategy[];

  constructor(ttlSeconds: number, redisUrl: string) {
    this.strategies = [
      new NodeCacheStrategy(ttlSeconds),
      new RedisCacheStrategy(redisUrl)
    ];
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    await Promise.all(this.strategies.map(strategy => strategy.set(key, value, ttl)));
  }

  async get(key: string): Promise<any> {
    for (const strategy of this.strategies) {
      const value = await strategy.get(key);
      if (value !== null) return value;
    }
    return null;
  }

  async del(key: string): Promise<void> {
    await Promise.all(this.strategies.map(strategy => strategy.del(key)));
  }

  async flush(): Promise<void> {
    await Promise.all(this.strategies.map(strategy => strategy.flush()));
  }

  async cacheCommittee(committee: any): Promise<void> {
    try {
      await this.set('latest_committee', committee);
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