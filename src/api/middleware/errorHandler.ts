import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`${err.name}: ${err.message}`);
  
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};