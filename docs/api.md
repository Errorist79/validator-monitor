# API Documentation

This document provides an overview of the main API endpoints in the Aleo Validator Monitoring System.

## Base URL

All API requests should be sent to: `http://your-api-base-url/api`

## Endpoints

### Validators

- `GET /validators`: Retrieve a list of all validators
- `GET /validators/:address`: Get details for a specific validator

### Blocks

- `GET /blocks/latest`: Get the latest block information
- `GET /blocks/:height`: Get block information for a specific height

### Consensus
- `GET /api/consensus/round`: Get the current consensus round.
- `GET /api/consensus/committee`: Get the current committee information.

### Performance Metrics

- `GET /metrics/:address`: Get performance metrics for a specific validator

### Alerts

- `GET /alerts/:address`: Get alerts for a specific validator

### Rewards

- `GET /rewards/:address`: Get reward information for a specific validator or delegator

## Error Handling

The API uses standard HTTP response codes to indicate the success or failure of requests. In case of an error, the response will include a JSON object with an `error` field providing more details about the error.

## Rate Limiting

API requests are subject to rate limiting to ensure fair usage. Please refer to the `apiLimiter` middleware for specific limits.

For more detailed information about the API implementation, please refer to the `src/api/index.ts` file in the source code.

## Authentication

Some endpoints may require authentication using JWT. Include the token in the `Authorization` header as `Bearer <token>`.

## Error Responses

Errors are returned in the following format:
