import express from 'express';
import { RewardsService } from '../../services/RewardsService.js';
import { SnarkOSDBService } from '../../services/SnarkOSDBService.js';
import { AleoSDKService } from '../../services/AleoSDKService.js';
import logger from '../../utils/logger.js';
import { config } from '../../config/index.js';

const router = express.Router();
const snarkOSDBService = new SnarkOSDBService();
const aleoSDKService = new AleoSDKService(config.aleo.sdkUrl, config.aleo.networkType as 'mainnet' | 'testnet');
const rewardsService = new RewardsService(aleoSDKService, snarkOSDBService);

// Validator ödüllerini getir
router.get('/validator/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { startBlock, endBlock } = req.query;

    if (!startBlock || !endBlock) {
      return res.status(400).json({ error: 'startBlock ve endBlock parametreleri gereklidir.' });
    }

    const rewards = await rewardsService.getValidatorRewards(
      address,
      Number(startBlock),
      Number(endBlock)
    );

    res.json({ address, rewards: rewards.toString() });
  } catch (error) {
    logger.error('Validator ödülleri alınırken hata oluştu:', error);
    res.status(500).json({ error: 'Validator ödülleri alınırken bir hata oluştu.' });
  }
});

// Validator performans metriklerini getir
router.get('/validator/:address/metrics', async (req, res) => {
  try {
    const { address } = req.params;
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime ve endTime parametreleri gereklidir.' });
    }

    const metrics = await rewardsService.getValidatorPerformanceMetrics(
      address,
      Number(startTime),
      Number(endTime)
    );

    res.json({ address, metrics });
  } catch (error) {
    logger.error('Validator performans metrikleri alınırken hata oluştu:', error);
    res.status(500).json({ error: 'Validator performans metrikleri alınırken bir hata oluştu.' });
  }
});

// Validator performans raporu oluştur
router.get('/validator/:address/report', async (req, res) => {
  try {
    const { address } = req.params;
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'startTime ve endTime parametreleri gereklidir.' });
    }

    const report = await rewardsService.generateValidatorPerformanceReport(
      address,
      Number(startTime),
      Number(endTime)
    );

    res.json(report);
  } catch (error) {
    logger.error('Validator performans raporu oluşturulurken hata oluştu:', error);
    res.status(500).json({ error: 'Validator performans raporu oluşturulurken bir hata oluştu.' });
  }
});

export default router;
