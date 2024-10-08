# Configuration

This document outlines the configuration options for the Aleo Network Monitor project.

## Environment Variables

The project uses environment variables for configuration. These can be set in a `.env` file in the root directory of the project.

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL database connection URL | postgres://postgres:admin@localhost:5432/aleo |
| PORT | Port number for the API server | 3000 |
| ALEO_NETWORK_TYPE | Aleo network type (mainnet or testnet) | testnet |
| JWT_SECRET | Secret key for JWT token generation | your_jwt_secret |
| REDIS_URL | Redis connection URL for caching | redis://localhost:6379 |

## Configuration File

The main configuration file is located at `src/config/index.ts`. It loads environment variables and sets default values for various configuration options.

Key configuration options:

- `database`: Database connection settings
- `api`: API server settings
- `aleo`: Aleo network settings
- `uptime`: Uptime calculation settings
- `performance`: Performance metric calculation settings
- `sync`: Block synchronization settings

Example: