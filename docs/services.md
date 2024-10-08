# Services

This document provides an overview of the key services in the Aleo Network Monitor project.

## AleoSDKService

Responsible for interacting with the Aleo blockchain network.

Key methods:
- `getLatestBlock()`: Fetches the latest block from the network
- `getBlockByHeight(height: number)`: Retrieves a specific block by its height
- `getLatestCommittee()`: Fetches the current committee information
- `getValidatorStake(address: string)`: Retrieves the stake for a specific validator

## BlockSyncService

Manages the synchronization of blocks from the Aleo network to the local database.

Key methods:
- `syncLatestBlocks()`: Synchronizes the latest blocks from the network
- `syncBlockRange(startHeight: number, endHeight: number)`: Syncs a specific range of blocks

## PerformanceMetricsService

Calculates and manages performance metrics for validators.

Key methods:
- `calculateValidatorUptime(address: string, timeFrame: number)`: Calculates the uptime for a validator
- `getValidatorEfficiency(address: string, timeFrame: number)`: Calculates the efficiency of a validator
- `updateUptimes()`: Updates uptime snapshots for all validators

## AlertService

Monitors the network for anomalies and generates alerts.

Key methods:
- `checkMissedBlocks(validatorAddress: string, threshold: number)`: Checks if a validator has missed blocks
- `checkLowUptime(validatorAddress: string, threshold: number)`: Checks if a validator's uptime is below a threshold
- `getValidatorHealthStatus(validatorAddress: string)`: Retrieves the overall health status of a validator

## SnarkOSDBService

Manages database operations for the Aleo Network Monitor.

Key methods:
- `upsertBlocks(blocks: BlockAttributes[])`: Inserts or updates block data in the database
- `getLatestBlockHeight()`: Retrieves the height of the latest block in the database
- `getValidatorByAddress(address: string)`: Retrieves validator information from the database

## RewardsService

Manages the calculation and distribution of rewards.

Key methods:
- `processBlockRewards(block: APIBlock)`: Processes and distributes rewards for a given block
- `calculateValidatorReward(validatorAddress: string, blockReward: bigint, committee: LatestCommittee)`: Calculates the reward for a specific validator

For more detailed information on how these services interact, please refer to the [Architecture](architecture.md) document.