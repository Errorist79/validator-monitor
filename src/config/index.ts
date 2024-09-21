import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const config = {
    database: {
        url: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/aleo_monitor',
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
        calculationPeriod: parseInt(process.env.UPTIME_CALCULATION_PERIOD || '1800', 10), // 30 dakika varsayılan
        defaultValidatorAddress: process.env.DEFAULT_VALIDATOR_ADDRESS || '',
    },
};

const sequelize = new Sequelize(config.database.url, {
    logging: console.log,
});

// Define User model
const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
});

// Initialize and test database connection
export async function initDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Successfully connected to the database.');

        // Synchronize models (create tables)
        await sequelize.sync({ alter: true }); // Using alter: true instead of force: true
        console.log('Database models synchronized.');

    } catch (error) {
        console.error('Error occurred while initializing the database:', error);
        throw error; // Throw the error up
    }
}

// We're not calling initDatabase function here

export { sequelize, User, config };