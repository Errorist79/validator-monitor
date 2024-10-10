# Architecture

The Aleo Validator Monitoring System is built with a modular architecture, consisting of several interconnected services. Here's an overview of the system architecture:

## Core Components

1. **Database Services**
   - BaseDBService
   - DatabaseInitializationService
   - BlockDBService
   - CommitteeDBService
   - BatchDBService
   - RewardsDBService
   - UptimeDBService
   - MappingDBService

2. **Core Services**
   - SnarkOSDBService
   - BlockSyncService
   - ValidatorService
   - PerformanceMetricsService
   - AlertService
   - RewardsService
   - CacheService
   - AleoSDKService

3. **API and Web Interface**
   - Express.js based API
   - React-based web interface (separate repository)

## Service Interactions

- The `BlockSyncService` fetches new blocks from the Aleo network using `AleoSDKService` and stores them in the database using various database services.
- The `ValidatorService` manages validator information and status updates.
- The `PerformanceMetricsService` calculates performance metrics like uptime for validators.
- The `AlertService` monitors validator performance and triggers alerts when necessary.
- The `RewardsService` calculates and manages rewards for validators and delegators.
- The `CacheService` provides caching capabilities to improve performance.

## Data Flow

1. Block data is fetched from the Aleo network and stored in the database.
2. Validator information is updated based on the latest block data.
3. Performance metrics are calculated using the stored data.
4. The API serves the processed data to the web interface.
5. Alerts are generated based on predefined conditions.

For more detailed information about each service, please refer to the [Services](services.md) document.