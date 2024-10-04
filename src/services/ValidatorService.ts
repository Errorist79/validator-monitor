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
    const startTime = Math.floor(Date.now() / 1000) - 1 * 60 * 60; // Son 1 saat (saniye cinsinden)
    const endTime = Math.floor(Date.now() / 1000); // Şu an (saniye cinsinden)

    const recentBatches = await this.snarkOSDBService.getValidatorBatches(validatorAddress, startTime, endTime);
    const recentSignatures = await this.snarkOSDBService.getValidatorSignatures(validatorAddress, startTime, endTime);

    logger.debug(`Validator ${validatorAddress} son ${startTime} ile ${endTime} arasında ${recentBatches.length} batch işlemine ve ${recentSignatures.length} imzaya sahip`);

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

  /* async getValidatorPerformance(address: string): Promise<any> {
    try {
      const validator = await this.snarkOSDBService.executeQuery(
        'SELECT * FROM validators WHERE address = $1',
        [address]
      );
      if (validator.rows.length === 0) {
        throw new Error('Validator not found');
      }

      const recentBlocks = await this.snarkOSDBService.getBlocksByValidator(address, 100);
      
      const performance = {
        blocksProduced: recentBlocks.length,
        averageBlockTime: this.calculateAverageBlockTime(recentBlocks),
        totalBlocksProduced: validator.rows[0].total_blocks_produced,
        totalRewards: validator.rows[0].total_rewards.toString()
      };

      return {
        validator: {
          ...validator.rows[0],
          stake: validator.rows[0].stake.toString(), // BigInt'i string'e çevir
          bonded: validator.rows[0].bonded.toString() // BigInt'i string'e çevir
        },
        performance
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Validator performance calculation error: ${error.message}`);
      } else {
        throw new Error('An unknown error occurred during validator performance calculation');
      }
    }
  } */

  /* async updateValidatorUptime(validatorAddress: string): Promise<void> {
    try {
      const uptime = await this.performanceMetricsService.calculateUptime(validatorAddress);
      const lastUptimeUpdate = new Date();
      if (uptime !== null) {
        await this.snarkOSDBService.updateValidatorUptime(validatorAddress, uptime, lastUptimeUpdate);
        logger.info(`Updated uptime for validator ${validatorAddress}: ${uptime}%`);
      } else {
        logger.warn(`Unable to calculate uptime for validator ${validatorAddress}`);
      }
    } catch (error) {
      logger.error(`Error updating uptime for validator ${validatorAddress}:`, error);
      throw error;
    }
  }

  async updateAllValidatorsUptime(): Promise<void> {
    try {
      const validators = await this.snarkOSDBService.getValidators();
      for (const validator of validators) {
        await this.updateValidatorUptime(validator.address);
      }
      logger.info('Updated uptime for all validators');
    } catch (error) {
      logger.error('Error updating uptime for all validators:', error);
    }
  } */

/*   async getAllValidators(): Promise<any[]> {
    return this.snarkOSDBService.getValidators();
  }

  private calculateAverageBlockTime(blocks: any[]): number {
    if (blocks.length < 2) return 0;
    const timeDiffs = blocks.slice(1).map((block, index) => 
      new Date(block.timestamp).getTime() - new Date(blocks[index].timestamp).getTime()
    );
    return timeDiffs.reduce((sum, diff) => sum + diff, 0) / timeDiffs.length;
  }

  private calculateTotalFees(blocks: any[]): string {
    return blocks.reduce((sum, block) => sum + BigInt(block.total_fees), BigInt(0)).toString();
  } */
}

export default ValidatorService;