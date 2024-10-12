import { Router } from 'express';
import ConsensusService from '../../services/ConsensusService.js';
import logger from '../../utils/logger.js';

export default function(consensusService: ConsensusService) {
  const router = Router();

  // GET /api/consensus/round
  router.get('/round', async (req, res) => {
    try {
      const currentRound = await consensusService.getCurrentRound();
      if (currentRound === null) {
        res.status(404).json({ error: 'Current round could not be calculated' });
      } else {
        res.json({ currentRound });
      }
    } catch (error) {
      console.error('Error occurred while fetching current round:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error occurred' });
    }
  });

  // GET /api/consensus/committee
  router.get('/committee', async (req, res) => {
    try {
      console.info('Request received for /api/consensus/committee');
      const committee = await consensusService.getCommittee();
      console.info('Committee successfully retrieved');
      res.json({ committee });
    } catch (error) {
      console.error('Committee endpoint error:', error);
      if (error instanceof Error) {
        res.status(500).json({ error: `Failed to retrieve committee: ${error.message}` });
      } else {
        res.status(500).json({ error: 'Failed to retrieve committee: Unknown error occurred' });
      }
    }
  });

  return router;
}