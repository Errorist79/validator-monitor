# Configuration

This document outlines the configuration options for the Aleo Validator Monitoring System.

## Environment Variables

The following environment variables can be set to configure the application:

- `PORT`: The port on which the server will run (default: 4000)
- `DATABASE_URL`: PostgreSQL database connection string
- `REDIS_URL`: Redis connection string for caching
- `ALEO_SDK_URL`: URL for the Aleo SDK service
- `ALEO_NETWORK_TYPE`: 'mainnet' or 'testnet'
- `LOG_LEVEL`: Logging level (e.g., 'debug', 'info', 'warn', 'error')

## Configuration File

The main configuration is stored in `src/config/index.ts`. This file includes settings for:

- Database connection
- Redis connection
- Aleo network settings
- Sync settings
- API rate limiting

## Customizing Configuration

To customize the configuration:

1. Create a `.env` file in the root directory of the project.
2. Add the desired environment variables to the `.env` file.
3. The application will automatically load these variables on startup.

Example `.env` file:
```
PORT=5000
DATABASE_URL=postgres://user:password@localhost:5432/aleo_monitor
REDIS_URL=redis://localhost:6379
ALEO_SDK_URL=https://api.aleo.network
ALEO_NETWORK_TYPE=testnet
LOG_LEVEL=debug
```