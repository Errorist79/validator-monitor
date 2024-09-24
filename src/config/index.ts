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
        calculationMethod: process.env.UPTIME_CALCULATION_METHOD || 'block_range',
        blockRange: parseInt(process.env.UPTIME_BLOCK_RANGE || '100', 10),
        timeFrame: parseInt(process.env.UPTIME_TIME_FRAME || '3600', 10),
    },
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
};
export { config };
