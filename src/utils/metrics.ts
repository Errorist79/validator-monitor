class Metrics {
  private static instance: Metrics;
  private blocksProcessed: number = 0;
  private transactionsInMempool: number = 0;

  private constructor() {}

  public static getInstance(): Metrics {
    if (!Metrics.instance) {
      Metrics.instance = new Metrics();
    }
    return Metrics.instance;
  }

  public incrementBlocksProcessed(): void {
    this.blocksProcessed++;
  }

  public setTransactionsInMempool(count: number): void {
    this.transactionsInMempool = count;
  }

  public getBlocksProcessed(): number {
    return this.blocksProcessed;
  }

  public getTransactionsInMempool(): number {
    return this.transactionsInMempool;
  }
}

export const metrics = Metrics.getInstance();