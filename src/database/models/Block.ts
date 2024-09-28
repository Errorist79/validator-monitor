import { Model, DataTypes, Sequelize } from 'sequelize';

export interface BlockAttributes {
  height: number;
  hash: string;
  previous_hash: string;
  round: number;
  timestamp: number;
  transactions_count?: number;
  block_reward?: number; // BigInt yerine number kullanıyoruz
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
  timestamp: number;
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
  timestamp: number;
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

export interface APITransactionInput {
  type: string;
  id: string;
  value: string;
}

export interface APITransactionOutput {
  type: string;
  id: string;
  value: string;
}

export interface APITransitionExecution {
  transitions: {
    id: string;
    program: string;
    function: string;
    inputs: APITransactionInput[];
    outputs: APITransactionOutput[];
    tpk: string;
    tcm: string;
    scm: string;
  }[];
  global_state_root: string;
  proof: string;
}

export interface APITransactionFee {
  transition: {
    id: string;
    program: string;
    function: string;
    inputs: APITransactionInput[];
    outputs: APITransactionOutput[];
    tpk: string;
    tcm: string;
    scm: string;
  };
  global_state_root: string;
  proof: string;
}

export interface APITransaction {
  status: string;
  type: string;
  index: number;
  transaction: {
    type: string;
    id: string;
    execution?: APITransitionExecution; // Bu alanı isteğe bağlı yapıyoruz
    fee?: APITransactionFee;
  };
  finalize?: any[]; // Finalize yapısını daha spesifik hale getirebiliriz
}

export interface APIBlock {
  block_hash: string;
  previous_hash: string;
  header: APIBlockHeader;
  authority: APIAuthority;
  ratifications: APIRatification[]; // Ratifications yapısını daha spesifik hale getirebiliriz
  solutions: Record<string, never>; // Boş nesne
  transactions: APITransaction[];
  aborted_transaction_ids: string[];
}

export function convertBlockAttributesToAPIBlock(blockAttributes: BlockAttributes): APIBlock {
  return {
    block_hash: blockAttributes.hash,
    previous_hash: blockAttributes.previous_hash,
    header: {
      previous_state_root: '',
      transactions_root: '',
      finalize_root: '',
      ratifications_root: '',
      solutions_root: '',
      subdag_root: '',
      metadata: {
        network: 0,
        round: blockAttributes.round.toString(),
        height: blockAttributes.height.toString(),
        cumulative_weight: '0',
        cumulative_proof_target: 0,
        coinbase_target: 0,
        proof_target: 0,
        last_coinbase_target: 0,
        last_coinbase_timestamp: 0,
        timestamp: blockAttributes.timestamp
      },
    },
    authority: { type: '', subdag: { subdag: {} } },
    ratifications: [],
    solutions: {},
    transactions: [],
    aborted_transaction_ids: [],
  };
}

export interface APIRatification {
  type: string;
  amount?: number;
  data?: any; // Spesifik ratification tipine göre değişebilir
}

export class Block extends Model<BlockAttributes> implements BlockAttributes {
  public height!: number;
  public hash!: string;
  public previous_hash!: string;
  public round!: number;
  public timestamp!: number;
  public transactions_count?: number;
  public block_reward?: number; // BigInt yerine number kullanıyoruz

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
      transactions_count: DataTypes.INTEGER,
      block_reward: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
    }, {
      sequelize,
      modelName: 'Block',
      indexes: [
        { fields: ['height'] },
        { fields: ['timestamp'] },
        { fields: ['round'] }
      ]
    });
  }

  static fromAPIBlock(apiBlock: APIBlock): BlockAttributes {
    const blockReward = apiBlock.ratifications.find(r => r.type === 'block_reward');
    return {
      height: parseInt(apiBlock.header.metadata.height),
      hash: apiBlock.block_hash,
      previous_hash: apiBlock.previous_hash,
      round: parseInt(apiBlock.header.metadata.round),
      timestamp: Number(apiBlock.header.metadata.timestamp),
      transactions_count: apiBlock.transactions.length,
      block_reward: blockReward ? Number(blockReward.amount) : undefined,
    };
  }
}

export default Block;