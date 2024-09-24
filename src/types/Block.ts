export interface Block {
  height: number;
  hash: string;
  previous_hash: string;
  timestamp: string | undefined;
  transactions: any[];
  validator_address: string | undefined;
  total_fees: string | bigint | undefined;
  transactions_count: number;
  header: {
    metadata: {
      height: string;
      timestamp: string;
      round: string;
    };
  };
  authority: {
    type: string;
    subdag?: {
      subdag?: Record<string, any[]>;
    };
  };
  block_hash: string;
  ratifications: Array<{
    type: string;
    amount: number;
  }>;
  solutions: {
    version: number;
  };
  aborted_solution_ids: string[];
  aborted_transaction_ids: string[];
}

export interface APIBlock {
  header: {
    metadata: {
      height: string;
      timestamp: string;
    };
  };
  block_hash: string;
  previous_hash: string;
  transactions: any[];
  authority: {
    subdag: {
      subdag: {
        [key: string]: {
          batch_header: {
            author: string;
          };
        }[];
      };
    };
  };
  signature: string;
}