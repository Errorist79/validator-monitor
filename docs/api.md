# API Documentation

## Endpoints

### Validators

- `GET /api/validators`: Retrieve all validators.
- `GET /api/validators/:address`: Retrieve a specific validator by address.
- `GET /api/validators/:address/performance`: Get performance metrics for a specific validator.
- `GET /api/validators/:address/efficiency`: Get efficiency metrics for a specific validator.
- `GET /api/validators/:address/rewards`: Get rewards information for a specific validator.
- `GET /api/validators/:address/health`: Get health status of a specific validator.
- `GET /api/validators/:address/uptime`: Get uptime percentage of a specific validator.

### Blocks

- `GET /api/blocks/latest`: Retrieve the latest block.
- `GET /api/blocks/:height`: Retrieve a block by its height.

### Consensus

- `GET /api/consensus/round`: Get the current consensus round.
- `GET /api/consensus/committee`: Get the current committee information.

### Primary

- `GET /api/primary/transmissions`: Collect primary transmissions.

### Test Endpoints

- `GET /api/test/latest-block`: Fetch the latest block (testing purposes).
- `GET /api/test/latest-committee`: Fetch the latest committee (testing purposes).
- `GET /api/test/block/:height`: Fetch a block by height (testing purposes).
- `GET /api/test/transaction/:id`: Fetch a transaction by ID (testing purposes).
- `GET /api/test/transactions/:height`: Fetch transactions for a specific block height (testing purposes).
- `GET /api/test/raw-latest-block`: Fetch the raw latest block data (testing purposes).

## Authentication

Some endpoints may require authentication using JWT. Include the token in the `Authorization` header as `Bearer <token>`.

## Error Responses

Errors are returned in the following format:
