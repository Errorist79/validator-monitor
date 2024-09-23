import express from 'express';
import { ValidatorService } from '../../services/ValidatorService.js';
import { PerformanceMetricsService } from '../../services/PerformanceMetricsService.js';
import { AlertService } from '../../services/AlertService.js';
import logger from '../../utils/logger.js';

const router = express.Router();

export default (validatorService: ValidatorService, performanceMetricsService: PerformanceMetricsService, alertService: AlertService) => {
  router.get('/', async (req, res) => {
    try {
      const validators = await validatorService.getAllValidators();
      res.json(validators);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const performance = await validatorService.getValidatorPerformance(address);
      res.json(performance);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Doğrulayıcı bulunamadı') {
          res.status(404).json({ error: error.message });
        } else {
          res.status(500).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address/performance', async (req, res) => {
    try {
      const { address } = req.params;
      const performance = await performanceMetricsService.calculateValidatorPerformance(address, 24 * 60 * 60);
      res.json(performance);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address/efficiency', async (req, res) => {
    try {
      const { address } = req.params;
      const { timeFrame } = req.query;
      const efficiency = await performanceMetricsService.getValidatorEfficiency(address, Number(timeFrame) || 24 * 60 * 60);
      res.json({ efficiency });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address/rewards', async (req, res) => {
    try {
      const { address } = req.params;
      const { timeFrame } = req.query;
      const rewards = await performanceMetricsService.getValidatorRewards(address, Number(timeFrame) || 24 * 60 * 60);
      res.json({ rewards: rewards.toString(), formattedRewards: formatRewards(rewards) });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address/health', async (req, res) => {
    try {
      const { address } = req.params;
      const healthStatus = await alertService.getValidatorHealthStatus(address);
      res.json(healthStatus);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:address/uptime', async (req, res) => {
    try {
      const { address } = req.params;
      const uptime = await performanceMetricsService.calculateUptime(address);
      res.json({ address, uptime });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  function formatRewards(rewards: bigint): string {
    return new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 2 }).format(Number(rewards) / 1e9) + ' ALEO';
  }

  return router;
};