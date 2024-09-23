import { AleoNetworkClient } from '@aleohq/sdk';
import crypto from 'crypto';
import { AleoSDKService } from './AleoSDKService';

interface Transmission {
  id: string;
  data: any;
}

export class PrimaryService {
  constructor(private aleoSDKService: AleoSDKService) {}

  async collectTransmissions(): Promise<Transmission[]> {
    try {
      const mempoolTransactions = await this.aleoSDKService.getTransactionsInMempool();
      return mempoolTransactions.map((tx: { id: string; [key: string]: any }) => ({
        id: tx.id,
        data: tx
      }));
    } catch (error) {
      console.error('Error occurred while collecting transmissions:', error);
      throw new Error('Failed to collect transmissions');
    }
  }
}

export default PrimaryService;
