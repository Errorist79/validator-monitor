import { Router } from 'express';
import ValidatorService from '../../services/ValidatorService.js';
import logger from '../../utils/logger.js';
import PerformanceMetricsService from '../../services/PerformanceMetricsService.js';

export default function(validatorService: ValidatorService, performanceMetricsService: PerformanceMetricsService) {
  const router = Router();

  // GET /api/validators
  router.get('/', async (req, res) => {
    try {
      const validators = await validatorService.getActiveValidators();
      res.json(validators);
    } catch (error) {
      console.error('Error occurred while fetching validator information:', error);
      res.status(500).json({ error: 'Failed to fetch validator information' });
    }
  });

  // GET /api/validators/:address/performance
  router.get('/:address/performance', async (req, res) => {
    try {
      const address = req.params.address;
      const performance = await performanceMetricsService.getValidatorPerformance(address);
      res.json({ performance });
    } catch (error: unknown) {
      logger.error(`Error fetching performance for validator ${req.params.address}:`, error);
      res.status(500).json({ error: 'Failed to fetch validator performance' });
    }
  });

  // Diğer validator rotalarını ekleyebilirsiniz

  return router;
}
