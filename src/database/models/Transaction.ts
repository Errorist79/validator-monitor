import { Model, DataTypes } from 'sequelize';
import { sequelize } from '../index.js';

export class Transaction extends Model {
  public id!: string;
  public block_height!: number;
  public fee!: bigint;
  public timestamp!: Date;
}

Transaction.init({
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  block_height: DataTypes.BIGINT,
  fee: DataTypes.BIGINT,
  timestamp: DataTypes.DATE,
}, {
  sequelize,
  modelName: 'Transaction',
});