# Database Schema

This document outlines the database schema used in the Aleo Network Monitor project.

## Tables

### `blocks`

Stores information about the blocks in the Aleo blockchain.

- `height` (BIGINT, Primary Key)
- `hash` (TEXT, Unique, Not Null)
- `previous_hash` (TEXT, Not Null)
- `round` (BIGINT, Not Null)
- `timestamp` (BIGINT, Not Null)
- `transactions_count` (INTEGER, Not Null)
- `block_reward` (NUMERIC)

### `committee_members`

Stores information about committee members (validators).

- `address` (TEXT, Primary Key)
- `first_seen_block` (BIGINT, Not Null)
- `last_seen_block` (BIGINT)
- `total_stake` (NUMERIC, Not Null)
- `is_open` (BOOLEAN, Not Null)
- `commission` (NUMERIC, Not Null)
- `is_active` (BOOLEAN, Not Null, Default `true`)
- `last_updated` (TIMESTAMP, Not Null, Default `NOW()`)

### `committee_participation`

Tracks committee participation of validators.

- `id` (SERIAL, Primary Key)
- `validator_address` (TEXT, References `committee_members(address)`)
- `committee_id` (TEXT, Not Null)
- `round` (BIGINT, Not Null)
- `block_height` (BIGINT, References `blocks(height)`)
- `timestamp` (BIGINT, Not Null)

### `batches`

Stores batch information.

- `batch_id` (TEXT, Not Null)
- `author` (TEXT, Not Null)
- `round` (BIGINT, Not Null)
- `timestamp` (BIGINT, Not Null)
- `committee_id` (TEXT, Not Null)
- `block_height` (BIGINT, References `blocks(height)`)

### `uptime_snapshots`

Stores uptime snapshots of validators.

- `id` (SERIAL, Primary Key)
- `validator_address` (TEXT, References `committee_members(address)`)
- `start_round` (BIGINT, Not Null)
- `end_round` (BIGINT, Not Null)
- `total_rounds` (INTEGER, Not Null)
- `participated_rounds` (INTEGER, Not Null)
- `uptime_percentage` (NUMERIC(5,2), Not Null)
- `calculated_at` (TIMESTAMP, Default `CURRENT_TIMESTAMP`)

### `validator_status`

Stores the status of validators.

- `address` (TEXT, Primary Key)
- `last_active_round` (BIGINT, Not Null)
- `consecutive_inactive_rounds` (INTEGER, Not Null, Default `0`)
- `is_active` (BOOLEAN, Not Null)
- `last_updated` (TIMESTAMP, Not Null, Default `NOW()`)

### `signature_participation`

Tracks signature participation in batches.

- `validator_address` (TEXT, Not Null)
- `batch_id` (TEXT, Not Null)
- `round` (BIGINT, Not Null)
- `committee_id` (TEXT, Not Null)
- `block_height` (BIGINT, Not Null)
- `timestamp` (BIGINT, Not Null)

## Relationships

- **Blocks** reference previous blocks via `previous_hash`.
- **Committee Participation** links validators to committees during specific rounds.
- **Batches** are associated with blocks and committees.
- **Signature Participation** tracks which validators have signed which batches.

## Indexes

- Indexes are added on commonly queried fields to improve performance, such as `blocks(height)`, `blocks(timestamp)`, and `blocks(round)`.

For more information on database operations and queries, please refer to the [Services](services.md) document.