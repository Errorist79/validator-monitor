import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { PerformanceMetricsService } from './PerformanceMetricsService.js';
import logger from '../utils/logger.js';

export class RewardsService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private performanceMetricsService: PerformanceMetricsService
  ) {}

  async calculateStakeRewards(validatorAddress: string, blockReward: bigint): Promise<bigint> {
    try {
      const totalNetworkStake = await this.aleoSDKService.getTotalNetworkStake();
      const committeeData = await this.aleoSDKService.getCommitteeMapping(validatorAddress);
      
      if (!committeeData || !committeeData.isOpen) {
        return BigInt(0); // Validator komitede değilse veya aktif değilse ödül yok
      }

      const bondedData = await this.aleoSDKService.getBondedMapping(validatorAddress);
      const validatorStake = bondedData ? bondedData.microcredits : BigInt(0);
      const delegatedAmount = await this.aleoSDKService.getDelegatedMapping(validatorAddress);

      const totalValidatorStake = validatorStake + delegatedAmount;

      // Validator'ın stake'inin ağ üzerindeki toplam stake'in 1/4'ünden fazla olup olmadığını kontrol et
      const maxAllowedStake = totalNetworkStake / BigInt(4);
      const effectiveStake = totalValidatorStake > maxAllowedStake ? maxAllowedStake : totalValidatorStake;

      // Minimum gereksinimi kontrol et (10 Milyon)
      const minimumStake = BigInt(10_000_000) * BigInt(1e9); // 10 milyon ALEO
      if (effectiveStake < minimumStake) {
        return BigInt(0);
      }

      const reward = (blockReward * effectiveStake) / totalNetworkStake;

      // Komisyon hesaplaması
      const validatorReward = (reward * BigInt(committeeData.commission)) / BigInt(100);
      const delegatorReward = reward - validatorReward;

      return validatorReward;
    } catch (error) {
      logger.error(`Error calculating stake rewards for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  // ... diğer metodlar ...
}

export default RewardsService;