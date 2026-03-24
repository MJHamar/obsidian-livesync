# Project Overview

Obsidian LiveSync is a community synchronization plugin for Obsidian vaults. It enables users to sync their notes, files, and vault data across multiple devices using CouchDB, MinIO/S3, or peer-to-peer WebRTC connections.

**Current Goal**: Decouple Obsidian-runtime related triggers from the synchronization logic and implement a watchdog-based file watching trigger system.

# Architecture

## Module System

The plugin uses a dynamic module system to reduce coupling:

- **Service Hub**: Central registry for services using dependency injection (`this.services`)
- **Module Loading**: All modules extend `AbstractModule` or `AbstractObsidianModule`

**Module Categories** (by directory under `src/modules/`):

- `core/` - Platform-independent core functionality
- `coreObsidian/` - Obsidian-specific core (e.g., `ModuleFileAccessObsidian`)
- `essential/` - Required modules (e.g., `ModuleMigration`, `ModuleKeyValueDB`)
- `features/` - Optional features (e.g., `ModuleLog`, `ModuleObsidianSettings`)
- `extras/` - Development/testing tools (e.g., `ModuleDev`, `ModuleIntegratedTest`)

## Key Architectural Components

- **LiveSyncLocalDB** (`src/lib/src/pouchdb/`): Local PouchDB database wrapper
- **Replicators** (`src/lib/src/replication/`): CouchDB, Journal, and MinIO sync engines
- **Service Hub** (`src/modules/services/`): Central service registry
- **Common Library** (`src/lib/`): Platform-independent sync logic

# Current Refactoring Goal

We are transitioning from Obsidian-runtime triggers to a watchdog-based file watching system:

## Old Approach

- Obsidian's native `on('create')`, `on('modify')`, `on('delete')` events directly trigger sync operations
- Tight coupling between Obsidian's event system and sync logic

## New Approach (In Progress)

- Implement a watchdog-based file watcher that monitors the filesystem independently
- Decouple file change detection from sync trigger logic
- Sync logic becomes event-driven based on watchdog notifications
- Better support for:
    - External file changes (e.g., git operations, external editors)
    - Headless/CLI operation without Obsidian runtime
    - Testing and mocking

## Design Principles

1. **Separation of Concerns**: File watching ≠ Sync logic
2. **Platform Independence**: Core sync logic should not depend on Obsidian APIs
3. **Extensibility**: Easy to add new trigger sources (webhooks, polling, etc.)

# File Structure Conventions

- **Platform-specific code**: Use `.platform.ts` suffix (replaced with `.obsidian.ts` in production)
- **Development code**: Use `.dev.ts` suffix (replaced with `.prod.ts` in production)
- **Path aliases**: `@/*` maps to `src/*`, `@lib/*` maps to `src/lib/src/*`

# Build & Development

```bash
npm run test:unit      # Run unit tests
npm run check          # TypeScript and svelte type checking
npm run dev            # Development build with auto-rebuild
npm run build          # Production build
npm run bakei18n       # Compile i18n resources (YAML → JSON → TS)
```

