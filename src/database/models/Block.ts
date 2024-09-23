import { Model, DataTypes, Sequelize } from 'sequelize';
import { sequelize } from '../index.js';

export class Block extends Model {
  public height!: number;
  public hash!: string;
  public validator_address!: string;
  public timestamp!: Date;
  public total_fees!: bigint;
}

export const initBlock = (sequelize: Sequelize) => {
  Block.init({
    height: {
      type: DataTypes.BIGINT,
      primaryKey: true,
    },
    hash: {
      type: DataTypes.STRING,
      unique: true,
    },
    validator_address: DataTypes.STRING,
    timestamp: DataTypes.DATE,
    transactions_count: DataTypes.INTEGER,
    total_fees: DataTypes.BIGINT,
  }, {
    sequelize,
    modelName: 'Block',
    indexes: [
      {
        fields: ['height']
      },
      {
        fields: ['validator_address']
      },
      {
        fields: ['timestamp']
      }
    ]
  });
};