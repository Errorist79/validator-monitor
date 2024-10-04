import { Model, DataTypes, Sequelize } from 'sequelize';

export interface BatchAttributes {
  batch_id: string;
  author: string;
  round: number;
  timestamp: number;
  committee_id: string;
  block_height: number;
}

export class Batch extends Model<BatchAttributes> implements BatchAttributes {
  public batch_id!: string;
  public author!: string;
  public round!: number;
  public timestamp!: number;
  public committee_id!: string;
  public block_height!: number;
}

export const initBatch = (sequelize: Sequelize) => {
  Batch.init({
    batch_id: {
      type: DataTypes.STRING,
      unique: true,
    },
    author: DataTypes.STRING,
    round: DataTypes.BIGINT,
    timestamp: DataTypes.BIGINT,
    committee_id: DataTypes.STRING,
    block_height: DataTypes.BIGINT,
  }, {
    sequelize,
    modelName: 'Batch',
    indexes: [
      { fields: ['batch_id'] },
      { fields: ['author'] },
      { fields: ['committee_id'] },
      { fields: ['round'] },
      { fields: ['block_height'] },
      { fields: ['timestamp'] },
    ]
  });
};