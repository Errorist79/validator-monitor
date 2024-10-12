import { Router } from 'express';
import PrimaryService from '../../services/PrimaryService.js';
import logger from '../../utils/logger.js';

export default function(primaryService: PrimaryService) {
  const router = Router();

  // GET /api/primary/transmissions
  router.get('/transmissions', async (req, res) => {
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

  return router;
}