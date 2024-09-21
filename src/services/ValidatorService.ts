import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';

export class ValidatorService {
  constructor(
    private aleoSDKService: AleoSDKService,
    public snarkOSDBService: SnarkOSDBService
  ) {}

  async updateValidators(): Promise<void> {
    try {
      const committee = await this.aleoSDKService.getLatestCommittee();
      const dbValidators = await this.snarkOSDBService.getValidators();

      for (const [address, data] of Object.entries(committee.members)) {
        const [stake, isActive, bonded] = data as [number, boolean, number];
        const dbValidator = dbValidators.find((v: { address: string }) => v.address === address);

        if (dbValidator) {
          await this.snarkOSDBService.executeQuery(
            'UPDATE validators SET stake = $1, is_active = $2, bonded = $3, last_seen = NOW() WHERE address = $4',
            [stake, isActive, bonded, address]
          );
        } else {
          await this.snarkOSDBService.executeQuery(
            'INSERT INTO validators (address, stake, is_active, bonded, last_seen) VALUES ($1, $2, $3, $4, NOW())',
            [address, stake, isActive, bonded]
          );
        }
      }

      logger.info(`${Object.keys(committee.members).length} validators successfully updated.`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error(`Validator update error: ${error.message}`);
      } else {
        logger.error('An unknown error occurred during validator update');
      }
    }
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
