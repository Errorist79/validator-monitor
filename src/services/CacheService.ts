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
    if (ttl) {
      await this.redis.setex(key, ttl, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async get(key: string): Promise<any> {
    return await this.redis.get(key);
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

  // Custom replacer function
  private replacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString() + 'n';
    }
    return value;
  }

  // Custom reviver function
  private reviver(key: string, value: any): any {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
      return BigInt(value.slice(0, -1));
    }
    return value;
  }

  private serialize(value: any): string {
    return JSON.stringify(value, (_, v) => 
      typeof v === 'bigint' ? v.toString() : v
    );
  }

  private deserialize(value: string): any {
    return JSON.parse(value, (_, v) => {
      if (typeof v === 'string' && /^\d+$/.test(v)) {
        try {
          return BigInt(v);
        } catch {
          return v;
        }
      }
      return v;
    });
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serializedValue = this.serialize(value);
    if (ttl) {
      await this.strategy.set(key, serializedValue, ttl);
    } else {
      await this.strategy.set(key, serializedValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.strategy.get(key);
    if (data) {
      try {
        return this.deserialize(data);
      } catch (error) {
        logger.error(`Error parsing cached data for key ${key}:`, error);
        return null;
      }
    }
    return null;
  }

  async del(key: string): Promise<void> {
    await this.strategy.del(key);
  }

  async flush(): Promise<void> {
    await this.strategy.flush();
  }


  async cacheCommittee(committee: any): Promise<void> {
    try {
      await this.set('latest_committee', committee, 60 * 60); // 1 hour TTL
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
