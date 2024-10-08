import { Model, DataTypes, Sequelize } from 'sequelize';

export interface CommitteeParticipationAttributes {
  id: number;
  validator_address: string;
  committee_id: string;
  round: number;
  block_height: number;
  timestamp: number;
}
export interface CommitteeData {
  committee_id: string;
  rounds: bigint[];
}
export class CommitteeParticipation extends Model<CommitteeParticipationAttributes> implements CommitteeParticipationAttributes {
  public id!: number;
  public validator_address!: string;
  public committee_id!: string;
  public round!: number;
  public block_height!: number;
  public timestamp!: number;
}

export const initCommitteeParticipation = (sequelize: Sequelize) => {
  CommitteeParticipation.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    validator_address: {
      type: DataTypes.STRING,
      references: {
        model: 'committee_members',
        key: 'address',
      },
    },
    committee_id: DataTypes.STRING,
    round: DataTypes.BIGINT,
    block_height: DataTypes.BIGINT,
    timestamp: DataTypes.BIGINT,
  }, {
    sequelize,
    modelName: 'CommitteeParticipation',
    indexes: [
      { fields: ['validator_address', 'round'] },
      { fields: ['committee_id', 'round'] },
      { fields: ['timestamp'] }
    ]
  });
};