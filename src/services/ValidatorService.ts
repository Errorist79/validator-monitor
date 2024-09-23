import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import { PerformanceMetricsService } from './PerformanceMetricsService.js';
import logger from '../utils/logger.js';

export class ValidatorService {
  constructor(
    private aleoSDKService: AleoSDKService,
    private snarkOSDBService: SnarkOSDBService,
    private performanceMetricsService: PerformanceMetricsService
  ) {}

  async updateValidators(): Promise<void> {
    try {
      const committeeInfo = await this.aleoSDKService.getLatestCommittee();
      const dbValidators = await this.snarkOSDBService.getValidators();

      for (const [address, data] of Object.entries(committeeInfo.members)) {
        const [stake, isActive, commission] = data;
        const dbValidator = dbValidators.find((v: { address: string }) => v.address === address);

        if (dbValidator) {
          await this.snarkOSDBService.updateValidator(address, BigInt(stake), isActive, BigInt(commission));
        } else {
          await this.snarkOSDBService.insertValidator(address, BigInt(stake), isActive, BigInt(commission));
        }
      }

      logger.info(`${Object.keys(committeeInfo.members).length} validators successfully updated.`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Validator update error: ${error.message}`);
      } else {
        logger.error('An unknown error occurred during validator update');
      }
    }
  }

  async getValidator(address: string): Promise<any> {
    const validators = await this.snarkOSDBService.getValidators();
    const validator = validators.find(v => v.address === address);
    if (!validator) {
      throw new Error('Validator not found');
    }
    return validator;
  }

  async getValidatorPerformance(address: string): Promise<any> {
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
        totalFees: this.calculateTotalFees(recentBlocks).toString(), // BigInt'i string'e çevir
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
  }

  async updateValidatorUptime(validatorAddress: string): Promise<void> {
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
  }

  async getAllValidators(): Promise<any[]> {
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
  }
}

export default ValidatorService;
