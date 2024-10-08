# Testing

This document outlines the testing strategy and procedures for the Aleo Network Monitor project.

## Testing Framework

The project uses Jest as the primary testing framework. Jest is configured in the `jest.config.js` file in the root directory.

## Types of Tests

1. Unit Tests: Test individual functions and methods in isolation.
2. Integration Tests: Test the interaction between different components of the system.
3. API Tests: Test the REST API endpoints.

## Running Tests

To run all tests:

```
npm test
```

To run tests with coverage:

```
npm run test:coverage
```

## Test Structure

Tests are located in the `src/tests` directory, mirroring the structure of the `src` directory.

Example test file structure:

```
src/
  tests/
    services/
      AleoSDKService.test.ts
      BlockSyncService.test.ts
    utils/
      logger.test.ts
    integration/
      api.test.ts
```

## Writing Tests

Here's an example of a test file:

```typescript
import { AleoSDKService } from '../../services/AleoSDKService';

describe('AleoSDKService', () => {
  let service: AleoSDKService;

  beforeEach(() => {
    service = new AleoSDKService('https://testnet.aleo.com', 'testnet');
  });

  it('should fetch the latest block', async () => {
    const block = await service.getLatestBlock();
    expect(block).toBeDefined();
    expect(block.height).toBeGreaterThan(0);
  });

  // More tests...
});
```

## Mocking

For tests that require external dependencies, use Jest's mocking capabilities to isolate the unit under test.

Example:

```typescript
jest.mock('../../services/AleoSDKService');

describe('BlockSyncService', () => {
  let mockAleoSDKService: jest.Mocked<AleoSDKService>;
  let blockSyncService: BlockSyncService;

  beforeEach(() => {
    mockAleoSDKService = new AleoSDKService() as jest.Mocked<AleoSDKService>;
    blockSyncService = new BlockSyncService(mockAleoSDKService);
  });

  it('should sync latest blocks', async () => {
    mockAleoSDKService.getLatestBlock.mockResolvedValue({ height: 100 });
    await blockSyncService.syncLatestBlocks();
    expect(mockAleoSDKService.getLatestBlock).toHaveBeenCalled();
  });

  // More tests...
});
```

## Continuous Integration

The project uses GitHub Actions for continuous integration. The CI pipeline runs all tests on every push and pull request to the main branch.

For more information on the project structure and components, please refer to the [Architecture](architecture.md) document.