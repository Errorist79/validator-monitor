import express from 'express';
import validatorRoutes from './routes/validators.js';
import blockRoutes from './routes/blocks.js';
import { ValidatorService } from '../services/ValidatorService.js';
import { BlockSyncService } from '../services/BlockSyncService.js';
import { PerformanceMetricsService } from '../services/PerformanceMetricsService.js';
import { AlertService } from '../services/AlertService.js';
import { errorHandler } from './middleware/errorHandler.js';
import alertRoutes from './routes/alerts.js';

const router = express.Router();

export default (validatorService: ValidatorService, blockService: BlockSyncService, performanceMetricsService: PerformanceMetricsService, alertService: AlertService) => {
  router.use('/validators', validatorRoutes(validatorService, performanceMetricsService, alertService));
  router.use('/blocks', blockRoutes(blockService));
  router.use(errorHandler);
  router.use('/alerts', alertRoutes(alertService));
  return router;
};