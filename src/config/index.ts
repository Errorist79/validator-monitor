import dotenv from 'dotenv';

dotenv.config();

const config = {
    database: {
        url: process.env.DATABASE_URL || 'postgres://postgres:admin@localhost:5432/aleo',
    },
    api: {
        port: process.env.PORT || 3000,
    },
    aleo: {
        sdkUrl: 'https://api.explorer.provable.com/v1',
        networkType: process.env.ALEO_NETWORK_TYPE || 'testnet',
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your_jwt_secret',
        expiresIn: '1d',
    },
    uptime: {
        calculationBlockRange: parseInt(process.env.UPTIME_CALCULATION_BLOCK_RANGE || '100', 10),
        calculationTimeFrame: 86400, // 24 saat
        averageBatchInterval: 5, // saniye cinsinden ortalama batch aralığı
        calculationRoundSpan: parseInt(process.env.CALCULATION_ROUND_SPAN || '500', 10),
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    sync: {
        startBlock: parseInt(process.env.SYNC_START_BLOCK || '0', 10),
    },
};
export { config };
