import { Router } from 'express';
import validatorsRoutes from './routes/validators.js';
import consensusRoutes from './routes/consensus.js';
import primaryRoutes from './routes/primary.js';
import ValidatorService from '../services/ValidatorService.js';
import BlockSyncService from '../services/BlockSyncService.js';
import PerformanceMetricsService from '../services/PerformanceMetricsService.js';
import AlertService from '../services/AlertService.js';
import RewardsService from '../services/RewardsService.js';
import AleoSDKService from '../services/AleoSDKService.js';
import ConsensusService from '../services/ConsensusService.js';
import PrimaryService from '../services/PrimaryService.js';

export default function(
  validatorService: ValidatorService,
  blockSyncService: BlockSyncService,
  performanceMetricsService: PerformanceMetricsService,
  alertService: AlertService,
  rewardsService: RewardsService,
  aleoSDKService: AleoSDKService,
  consensusService: ConsensusService,
  primaryService: PrimaryService
) {
  const router = Router();

  router.use('/validators', validatorsRoutes(validatorService));
  router.use('/consensus', consensusRoutes(consensusService));
  router.use('/primary', primaryRoutes(primaryService));
  // Diğer rotaları ekleyin

  return router;
}
