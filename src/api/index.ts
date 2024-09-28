import express from 'express';
import validatorRoutes from './routes/validators.js';
import blockRoutes from './routes/blocks.js';
import { ValidatorService } from '../services/ValidatorService.js';
import { BlockSyncService } from '../services/BlockSyncService.js';
import { PerformanceMetricsService } from '../services/PerformanceMetricsService.js';
import { AlertService } from '../services/AlertService.js';
import { RewardsService } from '../services/RewardsService.js';
import { errorHandler } from './middleware/errorHandler.js';
import alertRoutes from './routes/alerts.js';
import rewardRoutes from './routes/rewards.js';
import { AleoSDKService } from '../services/AleoSDKService.js';

const router = express.Router();

export default (
  validatorService: ValidatorService, 
  blockService: BlockSyncService, 
  performanceMetricsService: PerformanceMetricsService, 
  alertService: AlertService,
  rewardsService: RewardsService,
  aleoSDKService: AleoSDKService
) => {
  router.use('/validators', validatorRoutes(validatorService, performanceMetricsService, alertService));
  router.use('/blocks', blockRoutes(blockService));
  router.use('/alerts', alertRoutes(alertService));
  router.use('/rewards', rewardRoutes(rewardsService, aleoSDKService));
  router.use(errorHandler);
  return router;
};