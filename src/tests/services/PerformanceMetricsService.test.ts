import { PerformanceMetricsService } from '../../services/PerformanceMetricsService';
import { SnarkOSDBService } from '../../services/SnarkOSDBService';
import { AleoSDKService } from '../../services/AleoSDKService';
import { CommitteeParticipation } from '../../database/models/CommitteeParticipation.js';
import { Batch } from '../../database/models/Batch.js';

jest.mock('../../services/SnarkOSDBService');
jest.mock('../../services/AleoSDKService');

describe('PerformanceMetricsService', () => {
  let performanceMetricsService: PerformanceMetricsService;
  let mockSnarkOSDBService: jest.Mocked<SnarkOSDBService>;
  let mockAleoSDKService: jest.Mocked<AleoSDKService>;

  beforeEach(() => {
    mockSnarkOSDBService = new SnarkOSDBService() as jest.Mocked<SnarkOSDBService>;
    mockAleoSDKService = new AleoSDKService('https://api.explorer.provable.com/v1', 'testnet') as jest.Mocked<AleoSDKService>;
    performanceMetricsService = new PerformanceMetricsService(mockSnarkOSDBService, mockAleoSDKService);
  });

  describe('calculateUptime', () => {
    it('should calculate uptime correctly', async () => {
      const mockCommitteeEntries = [
        CommitteeParticipation.build({ id: 1, committee_member_id: 1, committee_id: 'committee1', round: 1, block_height: 1, timestamp: 1000 }),
        CommitteeParticipation.build({ id: 2, committee_member_id: 1, committee_id: 'committee1', round: 2, block_height: 2, timestamp: 2000 }),
      ];
      const mockBatches = [
        Batch.build({ id: 1, batch_id: 'batch1', author: 'testAddress', round: 1, timestamp: 1100, committee_id: 'committee1', block_height: 1 }),
        Batch.build({ id: 2, batch_id: 'batch2', author: 'testAddress', round: 1, timestamp: 1200, committee_id: 'committee1', block_height: 1 }),
        Batch.build({ id: 3, batch_id: 'batch3', author: 'testAddress', round: 2, timestamp: 2100, committee_id: 'committee1', block_height: 2 }),
      ];

      mockSnarkOSDBService.getCommitteeEntriesForValidator.mockResolvedValue(mockCommitteeEntries);
      mockSnarkOSDBService.getValidatorBatches.mockResolvedValue(mockBatches);
      mockSnarkOSDBService.getCommitteeSizeForRound.mockResolvedValue({ committee_size: 10 });

      const result = await performanceMetricsService.calculateUptime('testAddress', 2000);
      
      // Beklenen batch sayısı: (1000 / 5 / 10) + (1000 / 5 / 10) = 20 + 20 = 40
      // Gerçek batch sayısı: 2 + 1 = 3
      // Uptime: (3 / 40) * 100 = 7.5%
      expect(result).toBeCloseTo(7.5, 2);
    });

    // ... Diğer test senaryoları ...
  });

  // ... Diğer testler ...
});