import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: "Yetkilendirme token'ı gerekli" });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    (req as Request).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Geçersiz token' });
  }
};
