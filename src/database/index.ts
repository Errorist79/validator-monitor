import { Sequelize } from 'sequelize';
import { config } from '../config/index.js';

export const sequelize = new Sequelize(config.database.url, {
  dialect: 'postgres',
  logging: false,
});

// Define model relations here
import { Validator } from './models/Validator.js';
import { Block } from './models/Block.js';
import { Transaction } from './models/Transaction.js';

Block.belongsTo(Validator, { foreignKey: 'validator_address', as: 'validator' });
Validator.hasMany(Block, { foreignKey: 'validator_address', as: 'blocks' });

Transaction.belongsTo(Block, { foreignKey: 'block_height', as: 'block' });
Block.hasMany(Transaction, { foreignKey: 'block_height', as: 'transactions' });

export { Validator, Block, Transaction };