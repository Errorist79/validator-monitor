import { AleoSDKService } from './AleoSDKService.js';
import { SnarkOSDBService } from './SnarkOSDBService.js';
import logger from '../utils/logger.js';

export class SyncService {
  constructor(
    private aleoSDKService: AleoSDKService, 
    private snarkOSDBService: SnarkOSDBService
  ) {}

  async syncLatestBlocks(count: number = 100): Promise<void> {
    const startTime = Date.now();
    try {
      const latestBlockHeight = await this.aleoSDKService.getLatestBlockHeight();
      if (latestBlockHeight === null) {
        throw new Error('Failed to get latest block height');
      }

      const startHeight = Math.max(0, latestBlockHeight - count + 1);
      logger.info(`Starting synchronization from block ${startHeight} to ${latestBlockHeight}`);

      const blocks = [];
      for (let height = startHeight; height <= latestBlockHeight; height++) {
        const block = await this.aleoSDKService.getBlockByHeight(height);
        if (block) {
          blocks.push(block);
          if (blocks.length % 10 === 0) {
            logger.debug(`Fetched ${blocks.length} blocks`);
          }
        } else {
          logger.warn(`Failed to fetch block at height ${height}`);
        }
      }

      if (blocks.length > 0) {
        await this.snarkOSDBService.saveBlocks(blocks);
        logger.info(`Successfully synced ${blocks.length} blocks`);
      } else {
        logger.warn('No blocks to synchronize');
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      logger.info(`Synchronization completed in ${duration} seconds`);
    } catch (error) {
      logger.error('Error during block synchronization:', error);
      throw error;
    }
  }

  async updateCommitteeBondedDelegatedMap(): Promise<void> {
    try {
      const committee = await this.aleoSDKService.getLatestCommittee();
      const committeeMap: Record<string, [bigint, boolean, bigint]> = {};
      const bondedMap = new Map<string, bigint>();
      const delegatedMap = new Map<string, bigint>();

      for (const address of Object.keys(committee.members)) {
        const committeeData = await this.aleoSDKService.getCommitteeMapping(address);
        if (committeeData) {
          committeeMap[address] = [BigInt(committee.members[address][0]), committeeData.isOpen, BigInt(committeeData.commission)];
        }

        const bondedData = await this.aleoSDKService.getBondedMapping(address);
        if (bondedData) {
          bondedMap.set(address, bondedData.microcredits);
        }

        const delegatedData = await this.aleoSDKService.getDelegatedMapping(address);
        if (delegatedData) {
          delegatedMap.set(address, delegatedData);
        }
      }

      await this.snarkOSDBService.updateCommitteeMap(committeeMap);
      await this.snarkOSDBService.updateBondedMap(bondedMap);
      await this.snarkOSDBService.updateDelegatedMap(delegatedMap);

      logger.info('Committee, bonded, and delegated maps updated successfully');
    } catch (error) {
      logger.error('Error updating committee, bonded, and delegated maps:', error);
      throw error;
    }
  }

  async updateNetworkTotalStake(): Promise<void> {
    try {
      const committee = await this.aleoSDKService.getLatestCommittee();
      let totalStake = BigInt(0);

      for (const address of Object.keys(committee.members)) {
        const delegated = await this.aleoSDKService.getDelegatedMapping(address);
        totalStake += delegated;
      }

      await this.snarkOSDBService.updateNetworkTotalStake(totalStake);
      logger.info(`Network total stake updated: ${totalStake}`);
    } catch (error) {
      logger.error('Error updating network total stake:', error);
      throw error;
    }
  }

  async syncAndUpdateAll(blockCount: number = 100): Promise<void> {
    try {
      await this.syncLatestBlocks(blockCount);
      await this.updateCommitteeBondedDelegatedMap();
      await this.updateNetworkTotalStake();
      logger.info('Sync and update completed successfully');
    } catch (error) {
      logger.error('Error during sync and update process:', error);
      throw error;
    }
  }
}