import express from 'express';
// import RestApiService from './services/RestApiService.js';
import ValidatorService from './services/ValidatorService.js';
import BlockService from './services/BlockService.js';
import ConsensusService from './services/ConsensusService.js';
import PrimaryService from './services/PrimaryService.js';
import api from './api/index.js';
import logger from './utils/logger.js';
// import { authMiddleware } from './api/middleware/auth.js';
import { SyncService } from './services/SyncService.js';
import { apiLimiter } from './api/middleware/rateLimiter';
import { PerformanceMetricsService } from './services/PerformanceMetricsService.js';
import { AlertService } from './services/AlertService.js';
import cron from 'node-cron';
import { SnarkOSDBService } from './services/SnarkOSDBService.js';
import { config } from './config/index.js';
import AleoSDKService from './services/AleoSDKService.js';
import { NotFoundError, ValidationError } from './utils/errors.js';

const app = express();
let port = process.env.PORT ? parseInt(process.env.PORT) : 4000;

// Test the connection when the application starts

logger.info(`Initializing AleoSDKService with URL: ${config.aleo.sdkUrl} and network type: ${config.aleo.networkType}`);
const aleoSDKService = new AleoSDKService(config.aleo.sdkUrl, config.aleo.networkType as 'mainnet' | 'testnet');
const snarkOSDBService = new SnarkOSDBService();
const performanceMetricsService = new PerformanceMetricsService(snarkOSDBService, aleoSDKService);
const validatorService = new ValidatorService(aleoSDKService, snarkOSDBService, performanceMetricsService);
const blockService = new BlockService(aleoSDKService, snarkOSDBService);
const consensusService = new ConsensusService(aleoSDKService);
const primaryService = new PrimaryService(aleoSDKService);
const syncService = new SyncService(aleoSDKService, snarkOSDBService);
const alertService = new AlertService(snarkOSDBService, performanceMetricsService);

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
      logger.error('Error occurred while starting the server:', error);
    }
  });
}

async function main() {
  try {
    logger.info('Initializing database...');
    await snarkOSDBService.initializeDatabase();
    logger.info('Database initialized successfully');

    logger.info('Checking and updating database schema...');
    await snarkOSDBService.checkAndUpdateSchema();
    logger.info('Database schema check and update completed');

    // Diğer başlatma işlemleri...
    await tryConnect();
    startServer();

    // Periodic validator update
    setInterval(async () => {
      try {
        await validatorService.updateValidators();
      } catch (error) {
        logger.error('Error updating validators:', error);
      }
    }, 60 * 60 * 1000); // Every hour

    // Perform the first validator update immediately
    try {
      await validatorService.updateValidators();
    } catch (error) {
      logger.error('Error performing initial validator update:', error);
    }

    // Periodic block synchronization
    setInterval(async () => {
      try {
        await syncService.syncLatestBlocks(100);
      } catch (error) {
        logger.error('Block synchronization failed:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Perform the first block synchronization immediately
    try {
      await syncService.syncLatestBlocks(100);
    } catch (error) {
      logger.error('Error performing initial block synchronization:', error);
    }

    // Her 5 dakikada bir uptime hesaplaması
    cron.schedule('*/5 * * * *', async () => {
      try {
        const validators = await snarkOSDBService.getValidators();
        for (const validator of validators) {
          await validatorService.updateValidatorUptime(validator.address);
        }
        logger.info('Uptime calculation completed for all validators');
      } catch (error) {
        logger.error('Error during periodic uptime calculation:', error);
      }
    });

    // Her saat başı validator bilgilerini güncelle
    cron.schedule('0 * * * *', async () => {
      try {
        await validatorService.updateValidators();
        logger.info('Validator information updated');
      } catch (error) {
        logger.error('Error updating validator information:', error);
      }
    });

  } catch (error) {
    logger.error('Error occurred while starting the application:', error);
    if (error instanceof Error) {
      logger.error('Error details:', error.message);
      logger.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('An unexpected error occurred:', error);
  process.exit(1);
});

app.use('/api', api(validatorService, blockService, performanceMetricsService, alertService));

app.get('/api/validators', async (req, res) => {
  try {
    const validators = await snarkOSDBService.getValidators();
    res.json(validators);
  } catch (error) {
    logger.error('Error occurred while fetching validator information:', error);
    res.status(500).json({ error: 'Failed to fetch validator information' });
  }
});

app.get('/api/consensus/round', async (req, res) => {
  try {
    const currentRound = await consensusService.getCurrentRound();
    if (currentRound === null) {
      res.status(404).json({ error: 'Current round could not be calculated' });
    } else {
      res.json({ currentRound });
    }
  } catch (error) {
    logger.error('Error occurred while fetching current round:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error occurred' });
  }
});

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

app.get('/api/primary/transmissions', async (req, res) => {
  try {
    const transmissions = await primaryService.collectTransmissions();
    res.json({ transmissions });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
});

// Test routes
app.get('/api/test/latest-block', async (req, res) => {
  try {
    const latestBlock = await aleoSDKService.getLatestBlock();
    res.json(latestBlock);
  } catch (error) {
    logger.error('Error fetching latest block:', error);
    res.status(500).json({ error: 'Failed to fetch latest block' });
  }
});

app.get('/api/test/latest-committee', async (req, res) => {
  try {
    const latestCommittee = await aleoSDKService.getLatestCommittee();
    res.json(latestCommittee);
  } catch (error) {
    logger.error('Error fetching latest committee:', error);
    res.status(500).json({ error: 'Failed to fetch latest committee' });
  }
});

app.get('/api/test/block/:height', async (req, res) => {
  try {
    const height = parseInt(req.params.height);
    const block = await aleoSDKService.getBlock(height);
    res.json(block);
  } catch (error) {
    logger.error(`Error fetching block at height ${req.params.height}:`, error);
    res.status(500).json({ error: `Failed to fetch block at height ${req.params.height}` });
  }
});

app.get('/api/test/transaction/:id', async (req, res) => {
  try {
    const transaction = await aleoSDKService.getTransaction(req.params.id);
    res.json(transaction);
  } catch (error) {
    logger.error(`Error fetching transaction with id ${req.params.id}:`, error);
    res.status(500).json({ error: `Failed to fetch transaction with id ${req.params.id}` });
  }
});

app.get('/api/test/transactions/:height', async (req, res) => {
  try {
    const height = parseInt(req.params.height);
    const transactions = await aleoSDKService.getTransactions(height);
    res.json(transactions);
  } catch (error) {
    logger.error(`Error fetching transactions for block height ${req.params.height}:`, error);
    res.status(500).json({ error: `Failed to fetch transactions for block height ${req.params.height}` });
  }
});

// Add below the existing imports

// Add below other routes
app.get('/api/test/latest-block-structure', async (req, res) => {
  try {
    const latestBlock = await aleoSDKService.getLatestBlock();
    if (latestBlock) {
      res.json(latestBlock);
    } else {
      res.status(404).json({ error: 'Latest block not found' });
    }
  } catch (error) {
    logger.error('Error fetching latest block structure:', error);
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to fetch latest block structure' });
    }
  }
});

// Raw latest block endpoint
app.get('/api/test/raw-latest-block', async (req, res) => {
  try {
    const latestBlock = await aleoSDKService.getRawLatestBlock();
    res.json(latestBlock);
  } catch (error) {
    logger.error('Raw latest block fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch raw latest block' });
  }
});

app.get('/api/alerts/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const alerts = await alertService.checkAllAlerts(address);
    res.json(alerts);
  } catch (error) {
    logger.error('Error checking alerts:', error);
    res.status(500).json({ error: 'Failed to check alerts' });
  }
});

type CommitteeMember = [number, boolean, number];