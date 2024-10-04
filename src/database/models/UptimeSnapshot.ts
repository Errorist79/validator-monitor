import { Model, DataTypes, Sequelize } from 'sequelize';

export interface UptimeSnapshotAttributes {
  id?: number;
  validator_address: string;
  start_round: bigint;
  end_round: bigint;
  total_rounds: number;
  participated_rounds: number;
  uptime_percentage: number;
  calculated_at: Date;
}

export class UptimeSnapshot extends Model<UptimeSnapshotAttributes> implements UptimeSnapshotAttributes {
  public id!: number;
  public validator_address!: string;
  public start_round!: bigint;
  public end_round!: bigint;
  public total_rounds!: number;
  public participated_rounds!: number;
  public uptime_percentage!: number;
  public calculated_at!: Date;

  static initModel(sequelize: Sequelize): void {
    UptimeSnapshot.init({
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      validator_address: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      start_round: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      end_round: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      total_rounds: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      participated_rounds: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      uptime_percentage: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
      },
      calculated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    }, {
      sequelize,
      tableName: 'uptime_snapshots',
      timestamps: false,
    });
  }
}