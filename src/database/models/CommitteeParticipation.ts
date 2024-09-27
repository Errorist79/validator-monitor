import { Model, DataTypes, Sequelize } from 'sequelize';

export interface CommitteeParticipationAttributes {
  id: number;
  committee_member_id: number;
  committee_id: string;
  round: number;
  block_height: number;
  timestamp: number;
}

export class CommitteeParticipation extends Model<CommitteeParticipationAttributes> implements CommitteeParticipationAttributes {
  public id!: number;
  public committee_member_id!: number;
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
    committee_member_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'CommitteeMember',
        key: 'id',
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
      { fields: ['committee_member_id', 'round'] },
      { fields: ['committee_id', 'round'] },
      { fields: ['timestamp'] }
    ]
  });
};