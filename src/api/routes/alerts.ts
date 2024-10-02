import express from 'express';
import { AlertService } from '../../services/AlertService.js';

const router = express.Router();

export default (alertService: AlertService) => {
/*   router.get('/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const alerts = await alertService.checkAllAlerts(address);
      res.json(alerts);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  }); */

  return router;
};