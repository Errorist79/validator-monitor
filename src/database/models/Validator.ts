import { Model, DataTypes } from 'sequelize';
import { sequelize } from '../index.js';

export class Validator extends Model {
  public address!: string;
  public stake!: bigint;
  public last_seen!: Date;
  public total_blocks_produced!: number;
  public total_rewards!: bigint;
}

Validator.init({
  address: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  stake: DataTypes.BIGINT,
  last_seen: DataTypes.DATE,
  total_blocks_produced: DataTypes.INTEGER,
  total_rewards: DataTypes.BIGINT,
}, {
  sequelize,
  modelName: 'Validator',
});