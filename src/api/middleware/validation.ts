import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../../utils/errors.js';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      throw new ValidationError(error.details[0].message);
    }
    next();
  };
};