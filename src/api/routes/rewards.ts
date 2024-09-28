import express from 'express';
import { RewardsService } from '../../services/RewardsService.js';
import logger from '../../utils/logger.js';
import { AleoSDKService } from '../../services/AleoSDKService.js';

const router = express.Router();

export default (rewardsService: RewardsService, aleoSDKService: AleoSDKService) => {
  router.get('/calculate/:blockHeight', async (req, res) => {
    try {
      const blockHeight = parseInt(req.params.blockHeight);
      const block = await aleoSDKService.getBlock(blockHeight);
      if (block) {
        await rewardsService.calculateStakeRewards(block);
        res.json({ message: `Rewards calculated for block ${blockHeight}` });
      } else {
        res.status(404).json({ error: `Block ${blockHeight} not found` });
      }
    } catch (error) {
      logger.error('Error calculating rewards:', error);
      res.status(500).json({ error: 'Failed to calculate rewards' });
    }
  });

  router.get('/validator/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const startBlock = parseInt(req.query.startBlock as string) || 0;
      const endBlock = parseInt(req.query.endBlock as string) || await aleoSDKService.getLatestBlockHeight();
      if (endBlock === null) {
        throw new Error('Failed to get latest block height');
      }
      const rewards = await rewardsService.getValidatorRewards(address, startBlock, endBlock);
      res.json({ address, rewards: rewards.toString() });
    } catch (error) {
      logger.error('Error fetching validator rewards:', error);
      res.status(500).json({ error: 'Failed to fetch validator rewards' });
    }
  });

  return router;
};