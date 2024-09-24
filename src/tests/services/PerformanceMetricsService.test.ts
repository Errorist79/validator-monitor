import { PerformanceMetricsService } from '@/services/PerformanceMetricsService';
import { SnarkOSDBService } from '@/services/SnarkOSDBService';
import { AleoSDKService } from '@/services/AleoSDKService';

jest.mock('@/services/SnarkOSDBService');
jest.mock('@/services/AleoSDKService');

describe('PerformanceMetricsService', () => {
  let performanceMetricsService: PerformanceMetricsService;
  let mockSnarkOSDBService: jest.Mocked<SnarkOSDBService>;
  let mockAleoSDKService: jest.Mocked<AleoSDKService>;

  beforeEach(() => {
    mockSnarkOSDBService = new SnarkOSDBService() as jest.Mocked<SnarkOSDBService>;
    mockAleoSDKService = new AleoSDKService('https://api.explorer.provable.com/v1', 'testnet') as jest.Mocked<AleoSDKService>;
    performanceMetricsService = new PerformanceMetricsService(mockSnarkOSDBService, mockAleoSDKService);
  });

  test('calculateValidatorPerformance should return performance metrics', async () => {
    const mockBlocks = [{ height: 1, transactions_count: 5, total_fees: '100' }];
    const mockTransactions = [{ /* mock transaction data */ }];

    mockSnarkOSDBService.getBlocksByValidator = jest.fn().mockResolvedValue(mockBlocks);
    mockSnarkOSDBService.getTransactionsByValidator = jest.fn().mockResolvedValue(mockTransactions);

    const result = await performanceMetricsService.calculateValidatorPerformance('testAddress', 86400);

    expect(result).toHaveProperty('blocksProposed');
    expect(result).toHaveProperty('transactionsProcessed');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('averageResponseTime');
  });

  describe('calculateUptime', () => {
    it('should calculate uptime correctly', async () => {
      mockSnarkOSDBService.getTotalBlocksInTimeFrame.mockResolvedValue(100);
      mockSnarkOSDBService.getBlocksByValidator.mockResolvedValue(Array(80).fill({}));

      const result = await performanceMetricsService['calculateUptime']('testAddress');
      expect(result).toBe(80);
    });
  });

  describe('calculateAverageResponseTime', () => {
    it('should calculate average response time correctly', async () => {
      const mockBlocks = [
        { timestamp: new Date('2023-01-01T00:00:00Z') },
        { timestamp: new Date('2023-01-01T00:00:10Z') },
        { timestamp: new Date('2023-01-01T00:00:25Z') }
      ];
      mockSnarkOSDBService.getBlocksByValidator.mockResolvedValue(mockBlocks);

      const result = await performanceMetricsService['calculateAverageResponseTime']('testAddress', 3600);
      expect(result).toBe(12500); // (10000 + 15000) / 2 = 12500 ms
    });

    it('should return 0 if there are less than 2 blocks', async () => {
      mockSnarkOSDBService.getBlocksByValidator.mockResolvedValue([{ timestamp: new Date() }]);

      const result = await performanceMetricsService['calculateAverageResponseTime']('testAddress', 3600);
      expect(result).toBe(0);
    });
  });
});