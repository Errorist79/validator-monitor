import express from 'express';
import { BlockSyncService } from '../../services/BlockSyncService.js';
import logger from '../../utils/logger.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

const router = express.Router();

export default (blockSyncService: BlockSyncService) => {
  router.get('/latest', async (req, res) => {
    try {
      const latestBlock = await blockSyncService.getLatestSyncedBlockHeight();
      if (latestBlock) {
        res.json(latestBlock);
      } else {
        res.status(404).json({ error: 'Latest block not found' });
      }
    } catch (error) {
      logger.error('Error fetching latest block:', error);
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'An unexpected error occurred while fetching the latest block' });
      }
    }
  });

  return router;
};