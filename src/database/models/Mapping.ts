import { Model, DataTypes, Sequelize } from 'sequelize';


export interface BondedMapping {
    validator: string;
    microcredits: bigint;
  }
  
  export interface CommitteeMapping {
    is_open: boolean;
    commission: number;
  }
  
  export interface CommitteeMember {
    stake: bigint;
    is_open: boolean;
    commission: number;
  }
  
  export interface LatestCommittee {
    id: string;
    starting_round: number;
    members: Record<string, [number, boolean, number]>;
    total_stake: number;
  }
  
  // Yeni eklenen arayüzler
  export interface DelegatedMapping {
    delegator: string;
    microcredits: bigint;
  }
  
  export interface CommitteeState {
    committee: LatestCommittee;
    lastUpdated: number; // Unix timestamp
  }
  
  // Sequelize modeli için örnek (gerekirse kullanılabilir)
  export class Mapping extends Model {
    public validator!: string;
    public microcredits!: bigint;
  
    static initModel(sequelize: Sequelize): void {
      Mapping.init({
        validator: {
          type: DataTypes.STRING,
          primaryKey: true,
        },
        microcredits: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
      }, {
        sequelize,
        modelName: 'Mapping',
        tableName: 'mappings',
        timestamps: true,
      });
    }
  }