import { BlockDBService } from './database/BlockDBService.js';
import { ValidatorDBService } from './database/ValidatorDBService.js';
import { RewardsDBService } from './database/RewardsDBService.js';
import { CommitteeDBService } from './database/CommitteeDBService.js';
import { MappingDBService } from './database/MappingDBService.js';
import { UptimeDBService } from './database/UptimeDBService.js';
import { DatabaseInitializationService } from './database/DatabaseInitializationService.js';
import logger from '../utils/logger.js';
import { BlockAttributes } from '../database/models/Block.js';
import { UptimeSnapshotAttributes } from '../database/models/UptimeSnapshot.js';
import { PoolClient } from 'pg';

export class SnarkOSDBService {
  private blockDBService: BlockDBService;
  private validatorDBService: ValidatorDBService;
  private rewardsDBService: RewardsDBService;
  private committeeDBService: CommitteeDBService;
  private mappingDBService: MappingDBService;
  private uptimeDBService: UptimeDBService;
  private databaseInitializationService: DatabaseInitializationService;

  constructor() {
    this.blockDBService = new BlockDBService();
    this.validatorDBService = new ValidatorDBService();
    this.rewardsDBService = new RewardsDBService();
    this.committeeDBService = new CommitteeDBService();
    this.mappingDBService = new MappingDBService();
    this.uptimeDBService = new UptimeDBService();
    this.databaseInitializationService = new DatabaseInitializationService();

    logger.info('SnarkOSDBService initialized');
  }

  async checkDatabaseStructure(): Promise<boolean> {
    return this.databaseInitializationService.checkDatabaseStructure();
  }

  async initializeDatabase(): Promise<void> {
    const isStructureValid = await this.databaseInitializationService.checkDatabaseStructure();
    if (!isStructureValid) {
      await this.databaseInitializationService.initializeDatabase();
    } else {
      await this.databaseInitializationService.checkAndUpdateSchema();
    }
  }

  async getValidators(): Promise<any[]> {
    return this.validatorDBService.getValidators();
  }

  async getBlocksByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    return this.blockDBService.getBlocksByValidator(validatorAddress, timeFrame);
  }

  async getTransactionsByValidator(validatorAddress: string, timeFrame: number): Promise<any[]> {
    return this.blockDBService.getTransactionsByValidator(validatorAddress, timeFrame);
  }

  async upsertBlock(block: BlockAttributes): Promise<void> {
    return this.blockDBService.upsertBlock(block);
  }

  async upsertBlocks(blocks: BlockAttributes[], client?: PoolClient): Promise<void> {
    return this.blockDBService.upsertBlocks(blocks, client);
  }

  async getLatestBlockHeight(): Promise<number> {
    return this.blockDBService.getLatestBlockHeight();
  }

  async bulkInsertBlocks(blocks: BlockAttributes[]): Promise<void> {
    return this.blockDBService.bulkInsertBlocks(blocks);
  }

  async insertTransaction(transaction: any): Promise<void> {
    return this.blockDBService.insertTransaction(transaction);
  }
  async insertValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    return this.validatorDBService.insertValidator(address, stake, isOpen, commission);
  }

  async getValidatorUptime(validatorAddress: string): Promise<number> {
    return this.uptimeDBService.getValidatorUptime(validatorAddress);
  }

  async getValidatorRewards(validatorAddress: string, timeFrame: number): Promise<string> {
    return this.validatorDBService.getValidatorRewards(validatorAddress, timeFrame);
  }

  async insertCommitteeEntry(validatorAddress: string, startHeight: number, endHeight?: number): Promise<void> {
    return this.committeeDBService.insertCommitteeEntry(validatorAddress, startHeight, endHeight);
  }

  async insertOrUpdateValidator(address: string, stake: bigint): Promise<void> {
    return this.validatorDBService.insertOrUpdateValidator(address, stake);
  }

  async monitorValidatorPerformance(address: string, timeWindow: number): Promise<{
    committeeParticipations: number,
    signatureSuccesses: number,
    totalRewards: bigint
  }> {
    return this.validatorDBService.monitorValidatorPerformance(address, timeWindow);
  }

  async getLatestProcessedBlockHeight(): Promise<number> {
    return this.blockDBService.getLatestProcessedBlockHeight();
  }

  async updateValidatorParticipation(address: string, committeeParticipation: boolean, signatureSuccess: boolean, reward: bigint): Promise<void> {
    return this.validatorDBService.updateValidatorParticipation(address, committeeParticipation, signatureSuccess, reward);
  }

  async getTotalBlocksInTimeFrame(timeFrame: number): Promise<number> {
    return this.blockDBService.getTotalBlocksInTimeFrame(timeFrame);
  }

  async getBlocksCountByValidator(validatorAddress: string, timeFrame: number): Promise<number> {
    return this.blockDBService.getBlocksCountByValidator(validatorAddress, timeFrame);
  }

  async getTotalValidatorsCount(): Promise<number> {
    return this.validatorDBService.getTotalValidatorsCount();
  }

 /*  async getBlockCountBetween(startHeight: number, endHeight: number): Promise<number> {
    return this.blockDBService.getBlockCountBetween(startHeight, endHeight);
  } */

  async getLatestBlocks(limit: number = 100): Promise<any[]> {
    return this.blockDBService.getLatestBlocks(limit);
  } 

  async getBlockCountInHeightRange(startHeight: number, endHeight: number): Promise<number> {
    return this.blockDBService.getBlockCountInHeightRange(startHeight, endHeight);
  }

  async getValidatorBlockCountInHeightRange(validatorAddress: string, startHeight: number, endHeight: number): Promise<number> {
    return this.blockDBService.getValidatorBlockCountInHeightRange(validatorAddress, startHeight, endHeight);
  }

  async updateValidatorUptime(
    address: string,
    startRound: bigint,
    endRound: bigint,
    totalRounds: bigint,
    participatedRounds: bigint,
    uptimePercentage: number
  ): Promise<void> {
    return this.uptimeDBService.updateValidatorUptime(address, startRound, endRound, totalRounds, participatedRounds, uptimePercentage);
  }
  async getLatestUptimeSnapshot(validatorAddress: string): Promise<UptimeSnapshotAttributes | null> {
    return this.uptimeDBService.getLatestUptimeSnapshot(validatorAddress);
  }

  async getLastUptimeSnapshot(address: string): Promise<any | null> {
    return this.uptimeDBService.getLastUptimeSnapshot(address);
  }

  async updateBondedMap(bondedMap: Map<string, bigint>): Promise<void> {
    return this.mappingDBService.updateBondedMap(bondedMap);
  }

  async updateDelegatedMap(delegatedMap: Map<string, bigint>): Promise<void> {
    return this.mappingDBService.updateDelegatedMap(delegatedMap);
  }

  async insertOrUpdateCommitteeMember(
    address: string, 
    blockHeight: number, 
    total_stake: bigint, 
    isOpen: boolean, 
    commission: bigint
  ): Promise<void> {
    await this.committeeDBService.insertOrUpdateCommitteeMember(address, blockHeight, total_stake, isOpen, commission);
    await this.validatorDBService.updateValidatorStatus(address, BigInt(blockHeight), true);
  }

  async getValidatorByAddress(address: string): Promise<any | null> {
    return this.validatorDBService.getValidatorByAddress(address);
  }

  async updateValidator(address: string, stake: bigint, isOpen: boolean, commission: bigint): Promise<void> {
    return this.validatorDBService.updateValidator(address, stake, isOpen, commission);
  }

  async deactivateValidator(address: string): Promise<void> {
    return this.validatorDBService.deactivateValidator(address);
  }

  async getCommitteeSizeForRound(round: bigint): Promise<{ committee_size: number }> {
    return this.committeeDBService.getCommitteeSizeForRound(round);
  }

  async getCommitteeEntriesForValidator(validatorAddress: string, startTimestamp: number, endTimestamp: number): Promise<any[]> {
    return this.committeeDBService.getCommitteeEntriesForValidator(validatorAddress, startTimestamp, endTimestamp);
  }

  async getValidatorBatches(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    return this.blockDBService.getValidatorBatches(validatorAddress, startTime, endTime);
  }

  async getActiveValidators(): Promise<any[]> {
    return this.validatorDBService.getActiveValidators();
  }

  async getEarliestValidatorRound(validatorAddress: string): Promise<bigint | null> {
    return this.committeeDBService.getEarliestValidatorRound(validatorAddress);
  }

  async getTotalCommittees(startRound: bigint, endRound: bigint): Promise<any[]> {
    return this.committeeDBService.getTotalCommittees(startRound, endRound);
  }

  async getValidatorParticipation(validatorAddress: string, startRound: bigint, endRound: bigint): Promise<any[]> {
    return this.committeeDBService.getValidatorParticipation(validatorAddress, startRound, endRound);
  }

  async getSignatureParticipation(validatorAddress: string, startRound: bigint, endRound: bigint): Promise<any[]> {
    return this.committeeDBService.getSignatureParticipation(validatorAddress, startRound, endRound);
  }

  async insertUptimeSnapshot(uptimeSnapshot: Omit<UptimeSnapshotAttributes, 'id'>): Promise<void> {
    return this.uptimeDBService.insertUptimeSnapshot(uptimeSnapshot);
  }

  async checkCommitteesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    return this.committeeDBService.checkCommitteesAvailability(startHeight, endHeight);
  }

  async checkSignaturesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    return this.committeeDBService.checkSignaturesAvailability(startHeight, endHeight);
  }

  async checkBatchesAvailability(startHeight: number, endHeight: number): Promise<boolean> {
    return this.blockDBService.checkBatchesAvailability(startHeight, endHeight);
  }

  async updateValidatorStatus(address: string, blockHeight: bigint, isActive: boolean): Promise<void> {
    return this.validatorDBService.updateValidatorStatus(address, blockHeight, isActive);
  }

  async bulkInsertBatchInfos(batchInfos: any[], client?: PoolClient): Promise<void> {
    return this.blockDBService.bulkInsertBatchInfos(batchInfos, client);
  }

  async bulkInsertCommitteeMembers(committeeMembers: any[], client?: PoolClient): Promise<void> {
    return this.committeeDBService.bulkInsertCommitteeMembers(committeeMembers, client);
  }

  async bulkInsertCommitteeParticipations(committeeParticipations: any[], client?: PoolClient): Promise<void> {
    return this.committeeDBService.bulkInsertCommitteeParticipations(committeeParticipations, client);
  }

  async bulkInsertSignatureParticipations(signatureParticipations: any[], client?: PoolClient): Promise<void> {
    return this.committeeDBService.bulkInsertSignatureParticipations(signatureParticipations, client);
  }

  async getValidatorSignatures(validatorAddress: string, startTime: number, endTime: number): Promise<any[]> {
    return this.committeeDBService.getValidatorSignatures(validatorAddress, startTime, endTime);
  }

  async getDelegators(validatorAddress: string): Promise<any[]> {
    return this.validatorDBService.getDelegators(validatorAddress);
  }

  async updateValidatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    return this.rewardsDBService.updateValidatorRewards(address, reward, blockHeight);
  }

  async updateDelegatorRewards(address: string, reward: bigint, blockHeight: bigint): Promise<void> {
    return this.rewardsDBService.updateDelegatorRewards(address, reward, blockHeight);
  }

  async updateBlockReward(blockHash: string, reward: bigint): Promise<void> {
    return this.rewardsDBService.updateBlockReward(blockHash, reward);
  }
  
  async getValidatorRewardsInRange(validatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.rewardsDBService.getValidatorRewardsInRange(validatorAddress, startBlock, endBlock);
  }

  async getDelegatorRewardsInRange(delegatorAddress: string, startBlock: number, endBlock: number): Promise<bigint> {
    return this.rewardsDBService.getDelegatorRewardsInRange(delegatorAddress, startBlock, endBlock);
  }
}