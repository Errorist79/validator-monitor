import { PerformanceMetricsService } from '../services/PerformanceMetricsService';
import { SnarkOSDBService } from '../services/SnarkOSDBService';
import { AleoSDKService } from '../services/AleoSDKService';
import { config } from '../config/index';
import { Block } from '../types/Block';

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
  const testValidatorAddress = 'test_validator';

  beforeAll(async () => {
    // Test veritabanı bağlantısını kur
    process.env.TEST_DATABASE_URL = 'postgres://postgres:admin@localhost:5432/testdb';
    snarkOSDBService = new SnarkOSDBService();
    aleoSDKService = new AleoSDKService(config.aleo.sdkUrl, config.aleo.networkType as 'mainnet' | 'testnet'); // AleoSDKService örneği oluştur
    performanceMetricsService = new PerformanceMetricsService(snarkOSDBService, aleoSDKService);

    // Test veritabanını hazırla
    await snarkOSDBService.initializeDatabase();
    await addTestData(snarkOSDBService);
  });

  it('should calculate uptime correctly', async () => {
    const uptime = await performanceMetricsService.calculateUptime(testValidatorAddress);
    expect(uptime).toBeGreaterThan(0);
    expect(uptime).toBeLessThanOrEqual(100);
  });

  it('should calculate uptime for last 1 hour correctly', async () => {
    const uptimeLast1Hour = await performanceMetricsService.calculateUptime(testValidatorAddress);
    expect(uptimeLast1Hour).toBeGreaterThan(0);
    expect(uptimeLast1Hour).toBeLessThanOrEqual(100);
  });

  it('should calculate uptime for last 24 hours correctly', async () => {
    const uptimeLast24Hours = await performanceMetricsService.calculateUptime(testValidatorAddress);
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
    const block: Block = {
      height: height,
      hash: `block_hash_${i}`,
      previous_hash: `block_hash_${i - 1}`,
      timestamp: timestamp,
      transactions: [],
      validator_address: i % 5 === 0 ? validatorAddress : `other_validator_${i % 4}`,
      total_fees: BigInt(1000),
      transactions_count: 0,
      header: {
        metadata: {
          height: '',
          timestamp: '',
          round: ''
        }
      },
      authority: {
        type: '',
        subdag: undefined
      },
      block_hash: '',
      ratifications: [],
      solutions: {
        version: 0
      },
      aborted_solution_ids: [],
      aborted_transaction_ids: []
    };
    await snarkOSDBService.insertBlock(block);

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