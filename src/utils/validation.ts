import Joi from 'joi';

export const blockSchema = Joi.object({
  height: Joi.number().required(),
  hash: Joi.string().required(),
  previous_hash: Joi.string().required(),
  timestamp: Joi.string().isoDate().allow(null),
  transactions: Joi.array().items(Joi.object()).required(),
  validator_address: Joi.string().allow(null),
  total_fees: Joi.string().allow(null),
  transactions_count: Joi.number().required() // Bu satırı ekleyin
});

export function validateBlock(block: any) {
  return blockSchema.validate(block);
}