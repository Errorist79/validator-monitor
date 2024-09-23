export interface Block {
  height: number | undefined;
  hash: string | undefined;
  previous_hash: string;
  timestamp: string | undefined;
  transactions: any[];
  validator_address: string | undefined;
  total_fees: bigint | undefined;
  transactions_count: number | undefined;
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