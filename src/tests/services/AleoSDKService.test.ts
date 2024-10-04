import { jest } from '@jest/globals';
import { AleoNetworkClient } from '@provablehq/sdk';
import { AleoSDKService } from '../../services/AleoSDKService';
import { NotFoundError, ValidationError } from '../../utils/errors';

// Jest'i global olarak tanımlayalım
declare const describe: any;
declare const beforeEach: any;
declare const it: any;
declare const expect: any;

// AleoNetworkClient'ın beklediği Block tipini tanımlayalım
interface SDKBlock {
  block_hash: string;
  header: {
    previous_state_root: string;
    transactions_root: string;
    metadata: {
      height: string;
      timestamp: string;
    };
  };
  signature: string;
  // Diğer gerekli alanları ekleyin
}

jest.mock('@provablehq/sdk', () => ({
  AleoNetworkClient: jest.fn().mockImplementation(() => ({
    getLatestBlock: jest.fn(),
    // Diğer metodları da burada mock'layabilirsiniz
  })),
}));

jest.mock('../../utils/metrics', () => ({
  metrics: {
    incrementBlocksProcessed: jest.fn(),
    setTransactionsInMempool: jest.fn(),
  },
}));

describe('AleoSDKService', () => {
  let service: AleoSDKService;
  let mockNetworkClient: jest.Mocked<AleoNetworkClient>;

  beforeEach(() => {
    mockNetworkClient = {
      getLatestBlock: jest.fn(),
    } as unknown as jest.Mocked<AleoNetworkClient>;
    (AleoNetworkClient as jest.Mock).mockImplementation(() => mockNetworkClient);
    service = AleoSDKService.getInstance('https://api.explorer.provable.com/v1', 'testnet');
  });

  describe('getLatestBlock', () => {
    it('should return a valid block', async () => {
      const mockApiBlock: SDKBlock = {
        block_hash: "block_hash_123",
        header: {
          previous_state_root: "previous_state_root_123",
          transactions_root: "transactions_root_123",
          metadata: {
            height: "123",
            timestamp: "2023-01-01T00:00:00Z"
          }
        },
        signature: "signature_123"
        // Diğer gerekli alanları ekleyin
      };

      mockNetworkClient.getLatestBlock.mockResolvedValue(mockApiBlock as any);

      const result = await service.getLatestBlock();

      expect(result).toBeDefined();
      expect(result?.height).toBe(123);
      expect(result?.hash).toBe('block_hash_123');
    });

    it('should throw NotFoundError when no block is found', async () => {
      mockNetworkClient.getLatestBlock.mockResolvedValue(undefined as any);

      await expect(service.getLatestBlock()).rejects.toThrow(NotFoundError);
    });

    it('should return null on unknown error', async () => {
      mockNetworkClient.getLatestBlock.mockRejectedValue(new Error('Unknown error'));

      const result = await service.getLatestBlock();

      expect(result).toBeNull();
    });
  });

  // Diğer metodlar için benzer testler ekleyin...
});