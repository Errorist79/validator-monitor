# Deployment

This document outlines the deployment process for the Aleo Network Monitor project.

## Prerequisites

- Node.js v20.14.0 or higher
- PostgreSQL database
- Docker (optional, for containerized deployment)

## Deployment Options

1. Manual Deployment
2. Docker Deployment

## Manual Deployment

1. Clone the repository:
   ```
   git clone https://github.com/Errorist79/aleo-network-monitor.git
   ```

2. Navigate to the project directory:
   ```
   cd aleo-network-monitor
   ```

3. Install dependencies:
   ```
   npm install
   ```

4. Build the project:
   ```
   npm run build
   ```

5. Set up environment variables:
   Create a `.env` file in the root directory with the necessary configuration (refer to [Configuration](configuration.md)).

6. Start the application:
   ```
   npm start
   ```

## Docker Deployment

1. Build the Docker image:
   ```
   docker build -t aleo-network-monitor .
   ```

2. Run the container:
   ```
   docker run -p 4000:4000 --env-file .env aleo-network-monitor
   ```

## Database Migration

Before starting the application, ensure that the database is properly set up: