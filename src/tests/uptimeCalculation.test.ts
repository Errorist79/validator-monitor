import { PerformanceMetricsService } from '../services/PerformanceMetricsService.js';
import { SnarkOSDBService } from '../services/SnarkOSDBService.js';
import { AleoSDKService } from '../services/AleoSDKService.js';
import { config } from '../config/index.js';
import { Block, BlockAttributes } from '../database/models/Block.js';
import { BlockSyncService } from '../services/BlockSyncService.js';
import { CacheService } from '../services/CacheService.js';
import { BaseDBService } from '../services/database/BaseDBService.js'; // Added import for BaseDBService
import { ValidatorDBService } from '../services/database/ValidatorDBService.js';
import { ValidatorService } from '../services/ValidatorService.js';
// Jest'in global fonksiyonlarını tanımlayalım
declare const describe: jest.Describe;
declare const beforeAll: jest.Lifecycle;
declare const afterAll: jest.Lifecycle;
declare const it: jest.It;
declare const expect: jest.Expect;

describe('Uptime Calculation', () => {
  let snarkOSDBService: SnarkOSDBService;
  let aleoSDKService: AleoSDKService;
  let performanceMetricsService: PerformanceMetricsService;
  let mockBlockSyncService: jest.Mocked<BlockSyncService>;
  let cacheService: CacheService;
  let validatorDBService: ValidatorDBService;
  let validatorService: ValidatorService;
  const testValidatorAddress = 'test_validator';

  beforeAll(async () => {
    // Test veritabanı bağlantısını kur
    process.env.TEST_DATABASE_URL = 'postgres://postgres:admin@localhost:5432/testdb';
    snarkOSDBService = new SnarkOSDBService();
    aleoSDKService = new AleoSDKService(config.aleo.sdkUrl, config.aleo.networkType as 'mainnet' | 'testnet'); // AleoSDKService örneği oluştur
    cacheService = new CacheService(config.redis.url);
    validatorDBService = new ValidatorDBService();
    validatorService = new ValidatorService(aleoSDKService, snarkOSDBService, validatorDBService);
    const baseDBService = new BaseDBService(); // Gerçek bir BaseDBService oluşturun
    mockBlockSyncService = new BlockSyncService(aleoSDKService, snarkOSDBService, cacheService, baseDBService) as jest.Mocked<BlockSyncService>;
    performanceMetricsService = new PerformanceMetricsService(snarkOSDBService, aleoSDKService, mockBlockSyncService, cacheService, validatorService, validatorDBService);

    // Test veritabanını hazırla
    await snarkOSDBService.initializeDatabase();
    await addTestData(snarkOSDBService);
  });

  it('should calculate uptime correctly', async () => {
    const startHeight = 1000000;
    const endHeight = 1000720; // Örnek olarak 720 blok ekliyoruz
    const uptime = await performanceMetricsService.updateUptimes();
    expect(uptime).toBeGreaterThan(0);
    expect(uptime).toBeLessThanOrEqual(100);
  });

  it('should calculate uptime for last 1 hour correctly', async () => {
    const startHeight = 1000000;
    const endHeight = 1000360; // Örnek olarak 1 saatlik blok sayısı
    const uptimeLast1Hour = await performanceMetricsService.updateUptimes();
    expect(uptimeLast1Hour).toBeGreaterThan(0);
    expect(uptimeLast1Hour).toBeLessThanOrEqual(100);
  });

  it('should calculate uptime for last 24 hours correctly', async () => {
    const startHeight = 1000000;
    const endHeight = 1008640; // Örnek olarak 24 saatlik blok sayısı
    const uptimeLast24Hours = await performanceMetricsService.updateUptimes();
    expect(uptimeLast24Hours).toBeGreaterThan(0);
    expect(uptimeLast24Hours).toBeLessThanOrEqual(100);
  });
});

async function addTestData(snarkOSDBService: SnarkOSDBService) {
  const validatorAddress = 'test_validator';

  // Validator'ları ekle
  await snarkOSDBService.insertOrUpdateValidator(validatorAddress, BigInt(1000000));
  for (let i = 0; i < 4; i++) {
    await snarkOSDBService.insertOrUpdateValidator(`other_validator_${i}`, BigInt(1000000));
  }

  // Blokları ekle
  const startHeight = 1000000;
  const totalBlocks = 720;
  for (let i = 0; i < totalBlocks; i++) {
    const height = startHeight + i;
    const timestamp = new Date().toISOString(); // Basitlik için aynı zaman damgası
    const block: BlockAttributes = {
      height: height,
      hash: `block_hash_${i}`,
      previous_hash: `block_hash_${i - 1}`,
      round: height, // round değerini ekleyin (örneğin, height ile aynı olabilir)
      timestamp: new Date(timestamp).getTime(),
      transactions_count: 0,
      block_reward: 123456
    };
    await snarkOSDBService.upsertBlocks([block]);

    // Her 50 blokta bir committee entry ekle
    if (i % 50 === 0) {
      const entryStartHeight = height;
      const entryEndHeight = entryStartHeight + 49; // 50 blok sürecek
      await snarkOSDBService.insertCommitteeEntry(validatorAddress, entryStartHeight, entryEndHeight);
    }

    // Komite girişleri ekleme
    if (i % 10 === 0) {
      const entryStartHeight = height;
      const entryEndHeight = entryStartHeight + 9; // 10 blok sürecek
      await snarkOSDBService.insertCommitteeEntry(validatorAddress, entryStartHeight, entryEndHeight);
    }
  }
}