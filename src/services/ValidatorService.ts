import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { PerformanceMetricsService } from './PerformanceMetricsService.js';
import logger from '../utils/logger.js';
import pLimit from 'p-limit';

export class ValidatorService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private performanceMetricsService: PerformanceMetricsService
  ) {}

  async updateValidatorStatuses(): Promise<void> {
    try {
      const latestCommittee = await this.aleoSDKService.getLatestCommittee();
      const validators = await this.snarkOSDBService.getValidators();
      const currentRound = BigInt(latestCommittee.starting_round);

      logger.info(`Retrieved ${validators.length} validators for status update`);
      const limit = pLimit(5);
      await Promise.all(validators.map(validator =>
        limit(async () => {
          const isActive = await this.checkValidatorActivity(validator.address);
          logger.debug(`Validator ${validator.address} isActive: ${isActive}`);
          await this.snarkOSDBService.updateValidatorStatus(validator.address, currentRound, isActive);
        })
      ));

      logger.info('Updated validator statuses successfully');
    } catch (error) {
      logger.error('Error updating validator statuses:', error);
      throw error;
    }
  }

  private async checkValidatorActivity(validatorAddress: string): Promise<boolean> {
    const startTime = Math.floor(Date.now() / 1000) - 1 * 60 * 60; // Last 1 hour (in seconds)
    const endTime = Math.floor(Date.now() / 1000); // Current time (in seconds)

    // Check if validator has produced any batches or signatures in the last hour
    const recentBatches = await this.snarkOSDBService.getValidatorBatches(validatorAddress, startTime, endTime);
    const recentSignatures = await this.snarkOSDBService.getValidatorSignatures(validatorAddress, startTime, endTime);

    logger.debug(`Validator ${validatorAddress} has ${recentBatches.length} batch operations and ${recentSignatures.length} signatures between ${startTime} and ${endTime}`);

    return recentBatches.length > 0 || recentSignatures.length > 0;
  }

  async getValidator(address: string): Promise<any> {
    try {
      const validator = await this.snarkOSDBService.getValidatorByAddress(address);
      if (!validator) {
        throw new Error('Validator not found');
      }
      return validator;
    } catch (error) {
      logger.error(`Error getting validator with address ${address}:`, error);
      throw error;
    }
  }
  async getActiveValidators(): Promise<any[]> {
    try {
      // Aktif validatörleri veritabanından al
      const activeValidators = await this.snarkOSDBService.getActiveValidators();
      
      // Her bir validatör için ek bilgileri topla
      const validatorsWithDetails = await Promise.all(activeValidators.map(async (validator) => {
        const performance = await this.performanceMetricsService.getValidatorPerformance(validator.address);
        
        return {
          ...validator,
          performance
        };
      }));

      logger.info(`Retrieved ${validatorsWithDetails.length} active validators with details`);
      return validatorsWithDetails;
    } catch (error) {
      logger.error('Error getting active validators:', error);
      throw new Error('Aktif validatörleri alma işlemi başarısız oldu');
    }
  }

  public calculateAverageBlockTime(blocks: any[]): number {
    if (blocks.length < 2) {
      return 0; // Cannot calculate average, return 0
  }

  // Sort blocks by timestamp (oldest to newest)
  const sortedBlocks = blocks.sort((a, b) => a.timestamp - b.timestamp);

  // Calculate time differences between consecutive blocks
  const timeDifferences = sortedBlocks.slice(1).map((block, index) => {
    const currentBlockTime = new Date(block.timestamp).getTime();
    const previousBlockTime = new Date(sortedBlocks[index].timestamp).getTime();
    return currentBlockTime - previousBlockTime;
  });

  // Calculate average time difference
  const averageTimeDifference = timeDifferences.reduce((sum, diff) => sum + diff, 0) / timeDifferences.length;
  return averageTimeDifference / 1000;
}

  private calculateTotalFees(blocks: any[]): string {
    return blocks.reduce((sum, block) => sum + BigInt(block.total_fees), BigInt(0)).toString();
  } 
}

export default ValidatorService;