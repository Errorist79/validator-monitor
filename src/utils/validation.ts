import Joi from 'joi';

export const blockSchema = Joi.object({
  height: Joi.number().required(),
  hash: Joi.string().required(),
  previous_hash: Joi.string().required(),
  round: Joi.number().required(),
  timestamp: Joi.number().required(), // Burayı number olarak değiştirdik
  transactions_count: Joi.number().required(),
  block_reward: Joi.number().allow(null)
});


export function validateBlock(block: any) {
  return blockSchema.validate(block);
}