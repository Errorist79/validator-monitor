# Aleo Network Monitor

## Description

Aleo Network Monitor is a backend service designed to track and analyze the Aleo blockchain network. It provides real-time data on validators, blocks, and network performance metrics.

## Features

- Real-time block synchronization
- Validator performance tracking
- Alert system for network anomalies
- REST API for data retrieval
- Performance metrics calculation

## Prerequisites

- Node.js v20.14.0 or higher
- PostgreSQL database

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/Errorist79/aleo-network-monitor.git
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following:
   ```
   DATABASE_URL=postgres://user:password@localhost:5432/aleo_monitor
   PORT=4000
   ALEO_NETWORK_TYPE=testnet
   JWT_SECRET=your_jwt_secret
   ```

4. Initialize the database:
   ```
   npm run build
   node dist/config/index.js
   ```

## Usage

To start the server:
```
npm start
```

The server will start on the port specified in your `.env` file (default is 4000).

## API Endpoints

- `/api/validators`: Get all validators
- `/api/blocks/latest`: Get the latest block
- `/api/blocks/:height`: Get a block by height
- `/api/consensus/round`: Get the current consensus round
- `/api/consensus/committee`: Get the current committee
- `/api/alerts/:address`: Get alerts for a specific validator

For more detailed API documentation, please refer to the `docs/api.md` file.

## Testing

To run tests:
```
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.
