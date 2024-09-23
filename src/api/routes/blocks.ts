import express from 'express';
import { BlockService } from '../../services/BlockService.js';

const router = express.Router();

export default (blockService: BlockService) => {
  router.get('/latest', async (req, res) => {
    try {
      const latestBlock = await blockService.getLatestBlock();
      res.json(latestBlock);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  router.get('/:height', async (req, res) => {
    try {
      const { height } = req.params;
      const block = await blockService.getBlockByHeight(parseInt(height));
      if (!block) {
        res.status(404).json({ error: 'Blok bulunamadı' });
      } else {
        res.json(block);
      }
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Bilinmeyen bir hata oluştu' });
      }
    }
  });

  return router;
};