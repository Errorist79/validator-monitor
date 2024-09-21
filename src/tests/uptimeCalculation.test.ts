import { PerformanceMetricsService } from '../services/PerformanceMetricsService.js';
import { SnarkOSDBService } from '../services/SnarkOSDBService.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

async function testUptimeCalculation() {
  const snarkOSDBService = new SnarkOSDBService(config.database.url);
  const performanceMetricsService = new PerformanceMetricsService(snarkOSDBService);

  try {
    // Test için veritabanını hazırla
    await snarkOSDBService.clearDatabase();
    await snarkOSDBService.initializeDatabase();

    // Test verileri ekle
    await addTestData(snarkOSDBService);

    // Uptime hesapla
    const validatorAddress = config.uptime.defaultValidatorAddress || 'test_validator';
    const uptime = await performanceMetricsService.calculateUptime(validatorAddress);
    logger.info(`Calculated uptime for ${validatorAddress}: ${uptime}%`);

    // Farklı zaman aralıkları için test et
    const uptimeLast1Hour = await performanceMetricsService.calculateUptime(validatorAddress, 3600);
    logger.info(`Uptime for last 1 hour: ${uptimeLast1Hour}%`);

    const uptimeLast24Hours = await performanceMetricsService.calculateUptime(validatorAddress, 86400);
    logger.info(`Uptime for last 24 hours: ${uptimeLast24Hours}%`);

  } catch (error) {
    logger.error("Error during uptime calculation test:", error);
  }
}

async function addTestData(snarkOSDBService: SnarkOSDBService) {
  const validatorAddress = config.uptime.defaultValidatorAddress || 'test_validator';
  const currentTime = Date.now();
  const twoHoursAgo = currentTime - 2 * 60 * 60 * 1000;

  // Önce validator'ları ekle
  await snarkOSDBService.insertOrUpdateValidator(validatorAddress, BigInt(1000000));
  for (let i = 0; i < 4; i++) {
    await snarkOSDBService.insertOrUpdateValidator(`other_validator_${i}`, BigInt(1000000));
  }

  // Son 2 saat için her 10 saniyede bir blok ekle
  for (let i = 0; i < 720; i++) {
    const timestamp = new Date(twoHoursAgo + i * 10000).toISOString();
    const block = {
      height: 1000000 + i,
      hash: `block_hash_${i}`,
      previous_hash: `block_hash_${i-1}`,
      timestamp: timestamp,
      transactions: [],
      validator_address: i % 5 === 0 ? validatorAddress : `other_validator_${i % 4}`,
      total_fees: BigInt(1000)
    };
    await snarkOSDBService.insertBlock(block);
    
    // Her 50 blokta bir committee entry ekle
    if (i % 50 === 0) {
      await snarkOSDBService.insertCommitteeEntry(validatorAddress, 1000000 + i, 1000000 + i + 49);
    }
  }
}

testUptimeCalculation();