import { SnarkOSDBService } from './SnarkOSDBService.js';
import { PerformanceMetricsService } from './PerformanceMetricsService.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';

export class AlertService {
  constructor(
    private snarkOSDBService: SnarkOSDBService,
    private performanceMetricsService: PerformanceMetricsService
  ) {}

  async checkMissedBlocks(validatorAddress: string, threshold: number): Promise<boolean> {
    try {
      const recentBlocks = await this.snarkOSDBService.getBlocksByValidator(validatorAddress, 100);
      const missedBlocks = this.calculateMissedBlocks(recentBlocks);
      if (missedBlocks > threshold) {
        logger.warn(`Validator ${validatorAddress} missed ${missedBlocks} blocks, exceeding threshold of ${threshold}`);
        return true;
      }
      return false;
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Error checking missed blocks for validator ${validatorAddress}: ${error.message}`);
      } else {
        logger.error(`Error checking missed blocks for validator ${validatorAddress}: Bilinmeyen hata`);
      }
      throw error;
    }
  }

  private calculateMissedBlocks(blocks: any[]): number {
    if (blocks.length < 2) return 0;
    let missedBlocks = 0;
    for (let i = 1; i < blocks.length; i++) {
      missedBlocks += blocks[i].height - blocks[i-1].height - 1;
    }
    return missedBlocks;
  }

  /* async checkLowUptime(validatorAddress: string, threshold: number): Promise<boolean> {
    try {
      const uptime = await this.performanceMetricsService.calculateUptime(validatorAddress);
      if (uptime === null) {
        logger.warn(`Unable to calculate uptime for validator ${validatorAddress}`);
        return false;  // veya başka bir uygun değer
      }
      if (uptime < threshold) {
        logger.warn(`Validator ${validatorAddress} has low uptime: ${uptime}%, below threshold of ${threshold}%`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error checking uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  } */

  async checkLowRewards(validatorAddress: string, threshold: bigint, timeFrame: number): Promise<boolean> {
    try {
      const rewards = await this.snarkOSDBService.getValidatorRewards(validatorAddress, timeFrame);
      const rewardsBigInt = BigInt(rewards);
      if (rewardsBigInt < threshold) {
        logger.warn(`Validator ${validatorAddress} has low rewards: ${rewards}, below threshold of ${threshold}`);
        return true;
      }
      return false;
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Error checking rewards for validator ${validatorAddress}: ${error.message}`);
      } else {
        logger.error(`Error checking rewards for validator ${validatorAddress}: Bilinmeyen hata`);
      }
      throw error;
    }
  }

  /* async checkLowEfficiency(validatorAddress: string, threshold: number, timeFrame: number): Promise<boolean> {
    try {
      const efficiency = await this.performanceMetricsService.getValidatorEfficiency(validatorAddress, timeFrame);
      if (efficiency < threshold) {
        logger.warn(`Validator ${validatorAddress} has low efficiency: ${efficiency}%, below threshold of ${threshold}%`);
        return true;
      }
      return false;
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Error checking efficiency for validator ${validatorAddress}: ${error.message}`);
      } else {
        logger.error(`Error checking efficiency for validator ${validatorAddress}: Bilinmeyen hata`);
      }
      throw error;
    }
  } */

  /* async checkAllAlerts(validatorAddress: string): Promise<{
    missedBlocks: boolean,
    lowUptime: boolean,
    lowRewards: boolean,
    lowEfficiency: boolean
  }> {
    const missedBlocks = await this.checkMissedBlocks(validatorAddress, 5);
    const lowUptime = await this.checkLowUptime(validatorAddress, 95);
    const lowRewards = await this.checkLowRewards(validatorAddress, BigInt(1000), 24 * 60 * 60);
    const lowEfficiency = await this.checkLowEfficiency(validatorAddress, 90, 24 * 60 * 60);

    return {
      missedBlocks,
      lowUptime,
      lowRewards,
      lowEfficiency
    };
  }

  async getValidatorHealthStatus(validatorAddress: string): Promise<any> {
    try {
      const [lowUptime, lowRewards] = await Promise.all([
        this.checkLowUptime(validatorAddress, 90), // 90% threshold for uptime
        this.checkLowRewards(validatorAddress, BigInt(1000000), 24 * 60 * 60) // 1 ALEO threshold for 24 hours
      ]);

      return {
        address: validatorAddress,
        lowUptime,
        lowRewards
      };
    } catch (error) {
      logger.error(`Error getting health status for validator ${validatorAddress}:`, error);
      throw error;
    }
  } */

  private getAlertDescription(alertType: string): string {
    const descriptions: { [key: string]: string } = {
      missedBlocks: 'Validator has missed too many blocks',
      lowUptime: 'Validator has low uptime',
      lowRewards: 'Validator has low rewards',
      lowEfficiency: 'Validator has low efficiency'
    };
    return descriptions[alertType] || 'Unknown issue';
  }
}

export default AlertService;
