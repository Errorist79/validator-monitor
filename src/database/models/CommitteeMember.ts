import { Model, DataTypes, Sequelize } from 'sequelize';

export interface CommitteeMemberAttributes {
  id: number;
  address: string;
  first_seen_block: number;
  last_seen_block: number | null;
}

export class CommitteeMember extends Model<CommitteeMemberAttributes> implements CommitteeMemberAttributes {
  public id!: number;
  public address!: string;
  public first_seen_block!: number;
  public last_seen_block!: number | null;
}

export const initCommitteeMember = (sequelize: Sequelize) => {
  CommitteeMember.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    address: {
      type: DataTypes.STRING,
      unique: true,
    },
    first_seen_block: DataTypes.BIGINT,
    last_seen_block: DataTypes.BIGINT,
  }, {
    sequelize,
    modelName: 'CommitteeMember',
    indexes: [
      { fields: ['address'] }
    ]
  });
};