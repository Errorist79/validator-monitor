import { PerformanceMetricsService } from '../../services/PerformanceMetricsService';
import { SnarkOSDBService } from '../../services/SnarkOSDBService';
import { AleoSDKService } from '../../services/AleoSDKService';
import { CommitteeParticipation } from '../../database/models/CommitteeParticipation.js';
import { Batch } from '../../database/models/Batch.js';
import { BlockSyncService } from '../../services/BlockSyncService.js';
import { CacheService } from '../../services/CacheService.js';
import { config } from '../../config/index.js';
import { BaseDBService } from '../../services/database/BaseDBService.js';
import { ValidatorDBService } from '../../services/database/ValidatorDBService.js';
import { ValidatorService } from '../../services/ValidatorService.js';

jest.mock('../../services/SnarkOSDBService');
jest.mock('../../services/AleoSDKService');
jest.mock('../../services/CacheService');
jest.mock('../../services/ValidatorService');
jest.mock('../../services/database/ValidatorDBService');

describe('PerformanceMetricsService', () => {
  let performanceMetricsService: PerformanceMetricsService;
  let mockSnarkOSDBService: jest.Mocked<SnarkOSDBService>;
  let mockAleoSDKService: jest.Mocked<AleoSDKService>;
  let mockBlockSyncService: jest.Mocked<BlockSyncService>;
  let mockCacheService: jest.Mocked<CacheService>;
  let mockValidatorDBService: jest.Mocked<ValidatorDBService>;
  let mockValidatorService: jest.Mocked<ValidatorService>;

  beforeEach(() => {
    mockAleoSDKService = new AleoSDKService('https://api.explorer.provable.com/v1', 'testnet') as jest.Mocked<AleoSDKService>;
    mockSnarkOSDBService = new SnarkOSDBService() as jest.Mocked<SnarkOSDBService>;
    mockCacheService = new CacheService(config.redis.url) as jest.Mocked<CacheService>;
    const mockBaseDBService = {} as BaseDBService;
    mockBlockSyncService = new BlockSyncService(mockAleoSDKService, mockSnarkOSDBService, mockCacheService, mockBaseDBService) as jest.Mocked<BlockSyncService>;
    mockValidatorDBService = new ValidatorDBService() as jest.Mocked<ValidatorDBService>;
    mockValidatorService = new ValidatorService(
      mockAleoSDKService,
      mockSnarkOSDBService,
      mockValidatorDBService
    ) as jest.Mocked<ValidatorService>;

    performanceMetricsService = new PerformanceMetricsService(
      mockSnarkOSDBService,
      mockAleoSDKService,
      mockBlockSyncService,
      mockCacheService,
      mockValidatorService,
      mockValidatorDBService
    );

    mockValidatorService.setPerformanceMetricsService(performanceMetricsService);
  });

  describe('calculateUptime', () => {
    it('should calculate uptime correctly', async () => {
      const mockCommitteeEntries = [
        CommitteeParticipation.build({ id: 1, validator_address: "aleo1", committee_id: 'committee1', round: 1, block_height: 1, timestamp: 1000 }),
        CommitteeParticipation.build({ id: 2, validator_address: "aleo1", committee_id: 'committee1', round: 2, block_height: 2, timestamp: 2000 }),
      ];
      const mockBatches = [
        Batch.build({ batch_id: 'batch1', author: 'testAddress', round: 1, timestamp: 1100, committee_id: 'committee1', block_height: 1 }),
        Batch.build({ batch_id: 'batch2', author: 'testAddress', round: 1, timestamp: 1200, committee_id: 'committee1', block_height: 1 }),
        Batch.build({ batch_id: 'batch3', author: 'testAddress', round: 2, timestamp: 2100, committee_id: 'committee1', block_height: 2 }),
      ];

      mockSnarkOSDBService.getCommitteeEntriesForValidator.mockResolvedValue(mockCommitteeEntries);
      mockSnarkOSDBService.getValidatorBatches.mockResolvedValue(mockBatches);
      mockSnarkOSDBService.getCommitteeSizeForRound.mockResolvedValue({ committee_size: 10 });

      const startHeight = 1;
      const endHeight = 2;
      const result = await performanceMetricsService.updateUptimes();
      
      // Beklenen batch sayısı: (1000 / 5 / 10) + (1000 / 5 / 10) = 20 + 20 = 40
      // Gerçek batch sayısı: 2 + 1 = 3
      // Uptime: (3 / 40) * 100 = 7.5%
      expect(result).toBeCloseTo(7.5, 2);
    });

    // ... Diğer test senaryoları ...
  });

  describe('getValidatorPerformance', () => {
    it('should return performance metrics including committee participations and signature successes', async () => {
      const mockPerformanceData = {
        committeeParticipations: 50,
        signatureSuccesses: 48,
        totalRewards: BigInt(100000),
        uptimePercentage: 96
      };
      jest.spyOn(mockValidatorDBService, 'monitorValidatorPerformance').mockResolvedValue({
        committeeParticipations: 50,
        totalSignatures: 48,
        totalBatchesProduced: 48,
        totalRewards: '100000',
        performanceScore: 96
      });
      jest.spyOn(performanceMetricsService, 'getValidatorUptime').mockResolvedValue(96);

      const performance = await performanceMetricsService.getValidatorPerformance('test_validator');

      expect(performance).toEqual(mockPerformanceData);
    });
  });

  // ... Diğer testler ...
});
