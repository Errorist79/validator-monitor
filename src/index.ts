import express from 'express';
import ValidatorService from './services/ValidatorService.js';
import ConsensusService from './services/ConsensusService.js';
import PrimaryService from './services/PrimaryService.js';
import api from './api/index.js';
import logger from './utils/logger.js';
import { apiLimiter } from './api/middleware/rateLimiter';
import { PerformanceMetricsService } from './services/PerformanceMetricsService.js';
import { AlertService } from './services/AlertService.js';
import cron from 'node-cron';
import { SnarkOSDBService } from './services/SnarkOSDBService.js';
import { ValidatorDBService } from './services/database/ValidatorDBService.js';
import { config } from './config/index.js';
import AleoSDKService from './services/AleoSDKService.js';
import BlockSyncService from './services/BlockSyncService.js';
import RewardsService from './services/RewardsService.js';
import { CacheService } from './services/CacheService.js';
import { BaseDBService } from './services/database/BaseDBService.js';
import { RewardsDBService } from './services/database/RewardsDBService.js';
const app = express();
let port = process.env.PORT ? parseInt(process.env.PORT) : 4000;

// Loglama seviyesini debug'a çek
logger.level = 'debug';

logger.info(`Initializing AleoSDKService with URL: ${config.aleo.sdkUrl} and network type: ${config.aleo.networkType}`);
const cacheService = new CacheService(config.redis.url);
const aleoSDKService = new AleoSDKService(config.aleo.sdkUrl, config.aleo.networkType as 'mainnet' | 'testnet');
const snarkOSDBService = new SnarkOSDBService();
const baseDBService = new BaseDBService();
const rewardsDBService = new RewardsDBService();
const rewardsService = new RewardsService(snarkOSDBService, rewardsDBService);
const validatorDBService = new ValidatorDBService(rewardsService, snarkOSDBService);
let blockSyncService: BlockSyncService;
let performanceMetricsService: PerformanceMetricsService;
let validatorService: ValidatorService;
let alertService: AlertService;

const consensusService = new ConsensusService(aleoSDKService);
const primaryService = new PrimaryService(aleoSDKService);

logger.info(`ConsensusService initialized with URL: ${config.aleo.sdkUrl}`);

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

async function tryConnect(maxRetries = MAX_RETRIES, retryDelay = RETRY_DELAY) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await consensusService.testConnection();
      logger.info('Successfully connected to the Aleo network.');
      return;
    } catch (error) {
      logger.error(`Connection attempt ${attempt}/${maxRetries} failed:`, error);
      if (error instanceof Error) {
        logger.error('Error details:', error.message);
        logger.error('Error stack:', error.stack);
      }
      if (attempt < maxRetries) {
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  logger.error('Maximum retry count reached. Terminating the application.');
  process.exit(1);
}

function startServer() {
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
  }).on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is already in use. Trying a different port.`);
      port++;
      startServer();
    } else {
      logger.error('Server error:', error);
      process.exit(1);
    }
  });
}

async function initialize() {
  try {
    logger.info('Initializing and checking database...');
    await snarkOSDBService.initializeDatabase();
    logger.info('Database initialized and checked successfully');

    blockSyncService = new BlockSyncService(aleoSDKService, snarkOSDBService, cacheService, baseDBService);
    validatorService = new ValidatorService(aleoSDKService, snarkOSDBService, validatorDBService);
    performanceMetricsService = new PerformanceMetricsService(snarkOSDBService, aleoSDKService, blockSyncService, cacheService, validatorService, validatorDBService, rewardsService);
    validatorService.setPerformanceMetricsService(performanceMetricsService);
    alertService = new AlertService(snarkOSDBService, performanceMetricsService);

    app.use(express.json());
    app.use('/api', api(validatorService, blockSyncService, performanceMetricsService, alertService, rewardsService, aleoSDKService, consensusService, primaryService));

    startServer();
    await tryConnect();
    await blockSyncService.startSyncProcess();

  } catch (error) {
    logger.error('Initialization error:', error);
    process.exit(1);
  }
}

initialize();

// test routes:
// app.get('/api/test/latest-block', ...);
// app.get('/api/test/latest-committee', ...);
// app.get('/api/test/block/:height', ...);
// app.get('/api/test/transaction/:id', ...);
// app.get('/api/test/transactions/:height', ...);
// app.get('/api/test/latest-block-structure', ...);
// app.get('/api/test/raw-latest-block', ...);

// removed routes:
// app.get('/api/validators', ...); // moved
// app.get('/api/consensus/round', ...); // moved
// app.get('/api/consensus/committee', ...); // moved
// app.get('/api/primary/transmissions', ...); // moved 
// app.get('/api/alerts/:address', ...); // removed

app.get('/api/consensus/committee', async (req, res) => {
  try {
    logger.info('Request received for /api/consensus/committee');
    const committee = await consensusService.getCommittee();
    logger.info('Committee successfully retrieved');
    res.json({ committee });
  } catch (error) {
    logger.error('Committee endpoint error:', error);
    if (error instanceof Error) {
      res.status(500).json({ error: `Failed to retrieve committee: ${error.message}` });
    } else {
      res.status(500).json({ error: 'Failed to retrieve committee: Unknown error occurred' });
    }
  }
});

// Her 5 dakikada bir validator statülerini güncelle
cron.schedule('*/5 * * * *', async () => {
  try {
    logger.info('Starting validator status update');
    await validatorService.updateValidatorStatuses();
    logger.info('Completed validator status update');
  } catch (error) {
    logger.error('Error updating validator statuses:', error);
  }
});

