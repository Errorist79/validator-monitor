import { Model, DataTypes, Sequelize } from 'sequelize';

export interface BlockAttributes {
  height: number;
  hash: string;
  previous_hash: string;
  round: number;
  timestamp: number;
  validator_address?: string;
  transactions_count?: number;
}

export interface APIBlockMetadata {
  network: number;
  round: string;
  height: string;
  cumulative_weight: string;
  cumulative_proof_target: number;
  coinbase_target: number;
  proof_target: number;
  last_coinbase_target: number;
  last_coinbase_timestamp: number;
  timestamp: string;
}

export interface APIBlockHeader {
  previous_state_root: string;
  transactions_root: string;
  finalize_root: string;
  ratifications_root: string;
  solutions_root: string;
  subdag_root: string;
  metadata: APIBlockMetadata;
}

export interface APIBatchHeader {
  batch_id: string;
  author: string;
  round: string;
  timestamp: string;
  committee_id: string;
  transmission_ids: string[];
  previous_certificate_ids: string[];
  signature: string;
}

export interface APIBatch {
  batch_header: APIBatchHeader;
  signatures: string[];
}

export interface APIAuthority {
  type: string;
  subdag: APISubdag;
}

export interface APISubdag {
  subdag: {
    [key: string]: APIBatch[];
  };
}

export interface APIBlock {
  block_hash: string;
  previous_hash: string;
  header: APIBlockHeader;
  authority: APIAuthority;
  ratifications: APIRatification[];
  solutions: Record<string, never>; // Boş nesne
  transactions: APITransaction[];
  aborted_transaction_ids: string[];
}

export interface APITransaction {
  status: string;
  type: string;
  index: number;
  transaction: {
    type: string;
    id: string;
    execution?: any; // Bu alanı isteğe bağlı yapıyoruz
    fee?: {
      transition: any;
      global_state_root: string;
      proof: string;
    };
  };
  finalize?: any[];
}

export interface APITransition {
  id: string;
  program: string;
  function: string;
  inputs: string[];
  outputs: string[];
  proof: string;
  tpk: string;
  tcm: string;
}

export interface APIRatification {
  type: string;
  data: any; // Spesifik ratification tipine göre değişebilir
}

export class Block extends Model<BlockAttributes> implements BlockAttributes {
  public height!: number;
  public hash!: string;
  public previous_hash!: string;
  public round!: number;
  public timestamp!: number;
  public validator_address?: string;
  public transactions_count?: number;

  static initModel(sequelize: Sequelize): void {
    Block.init({
      height: {
        type: DataTypes.BIGINT,
        primaryKey: true,
      },
      hash: {
        type: DataTypes.STRING,
        unique: true,
      },
      previous_hash: DataTypes.STRING,
      round: DataTypes.BIGINT,
      timestamp: DataTypes.BIGINT,
      validator_address: DataTypes.STRING,
      transactions_count: DataTypes.INTEGER,
    }, {
      sequelize,
      modelName: 'Block',
      indexes: [
        { fields: ['height'] },
        { fields: ['validator_address'] },
        { fields: ['timestamp'] },
        { fields: ['round'] }
      ]
    });
  }

  static fromAPIBlock(apiBlock: APIBlock): BlockAttributes {
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: parseInt(apiBlock.header.metadata.timestamp),
      validator_address: apiBlock.authority?.subdag?.subdag?.[Object.keys(apiBlock.authority.subdag.subdag)[0]]?.[0]?.batch_header?.author,
      transactions_count: apiBlock.transactions.length,
    };
  }
}

export default Block;