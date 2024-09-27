import { Model, DataTypes, Sequelize } from 'sequelize';

export interface UptimeSnapshotAttributes {
  id: number;
  committee_member_id: number;
  start_round: number;
  end_round: number;
  total_rounds: number;
  participated_rounds: number;
  uptime_percentage: number;
  calculated_at: Date;
}

export class UptimeSnapshot extends Model<UptimeSnapshotAttributes> implements UptimeSnapshotAttributes {
  public id!: number;
  public committee_member_id!: number;
  public start_round!: number;
  public end_round!: number;
  public total_rounds!: number;
  public participated_rounds!: number;
  public uptime_percentage!: number;
  public calculated_at!: Date;
}

export const initUptimeSnapshot = (sequelize: Sequelize) => {
  UptimeSnapshot.init({
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
    start_round: DataTypes.BIGINT,
    end_round: DataTypes.BIGINT,
    total_rounds: DataTypes.INTEGER,
    participated_rounds: DataTypes.INTEGER,
    uptime_percentage: DataTypes.FLOAT,
    calculated_at: DataTypes.DATE,
  }, {
    sequelize,
    modelName: 'UptimeSnapshot',
    indexes: [
      { fields: ['committee_member_id', 'end_round'] }
    ]
  });
};