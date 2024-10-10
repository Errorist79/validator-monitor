# Services

This document provides an overview of the key services in the Aleo Network Monitor project.

## Database Services

### BaseDBService
Base class for database operations.

### DatabaseInitializationService
Handles database schema creation and updates.

Key methods:
- `checkDatabaseStructure()`: Checks the database structure
- `initializeDatabase()`: Initializes the database
- `checkAndUpdateSchema()`: Checks and updates the schema if necessary

### BlockDBService
Manages block data operations.

### CommitteeDBService
Handles committee-related data operations.

### BatchDBService
Manages batch data operations.

### RewardsDBService
Handles reward-related data operations.

### UptimeDBService
Manages uptime data operations.

### MappingDBService
Handles mapping data operations.

## Core Services

### SnarkOSDBService
Coordinates all database services.

Key methods:
- `initializeDatabase()`: Initializes or updates the database schema

### BlockSyncService
Synchronizes block data from the Aleo network.

Key methods:
- `startSyncProcess()`: Starts the block synchronization process
- `syncLatestBlocks()`: Synchronizes the latest blocks

### ValidatorService
Manages validator operations.

Key methods:
- `updateValidatorStatuses()`: Updates the status of all validators
- `getValidator(address)`: Retrieves information for a specific validator

### PerformanceMetricsService
Calculates performance metrics for validators.

Key method:
- `updateUptimes()`: Updates uptime values for validators

### AlertService
Manages the alert system for validators.

### RewardsService
Handles reward calculations and distributions.

### CacheService
Manages caching operations.

### AleoSDKService
Interfaces with the Aleo network.

## API and Web Interface
- Express.js based API
- React-based web interface (in a separate repository)

For more detailed information on how these services interact, please refer to the [Architecture](architecture.md) document.