# Devrun Architecture

This document explains how the current MVP is structured in code so contributors can find the right place to change behavior.

## High-Level Shape

Devrun is one local app with two halves:
- a Next.js UI for project/service selection, terminal viewing, and controls
- an Express/WebSocket backend that owns process lifecycle, persistence, and runtime state

The UI and backend speak through the same local API surface that AI operators can also use.

## Backend Runtime

### `src/backend/server.ts`

The backend entrypoint composes the app:
- starts Express and the Next.js request handler
- exposes REST endpoints such as `/api/state`, `/api/history`, `/api/logs`, and `/api/process/*`
- exposes a WebSocket endpoint for terminal attach
- seeds a few default local projects on startup
- auto-seeds a simple `web` service from `package.json` when a project has no saved config yet

If you need to change API contracts, project discovery, or startup seeding behavior, start here.

### `src/backend/processManager.ts`

`ProcessManager` owns service execution and runtime state:
- starts, stops, and restarts child processes
- injects runtime env vars such as `PORT`
- tracks per-run metadata like `runId`, `status`, `ready`, `warnings`, and `effectiveUrl`
- captures stdout/stderr into in-memory recent logs
- maintains low-noise lifecycle history
- manages WebSocket terminal clients
- records owned child processes and can clean up orphans after crashes/restarts

Recent changes also moved port ownership logic here:
- configured ports are treated as preferred starting points
- Devrun assigns the first available unreserved port at or above that starting point
- assigned ports are persisted so stopped services keep their slot
- local app URLs prefer `localhost`, with numeric loopback probes used internally to detect ambiguous IPv4/IPv6 behavior

If a bug involves readiness, URL detection, port conflicts, logs, or restart behavior, this is usually the primary file.

### Persistence modules

The backend stores local state in `.devrun/` through a few small modules:
- `src/backend/registry.ts`: registered projects
- `src/backend/config.ts`: saved per-project service config and `defaultService`
- `src/backend/portReservations.ts`: stable assigned-port bookkeeping
- `src/backend/historyStore.ts`: low-noise per-service lifecycle history
- `src/backend/storage.ts`: shared filesystem locations under `.devrun/`

These modules keep file I/O simple and synchronous because this is a local-first single-user MVP.

## Frontend Runtime

### `src/hooks/useDevrunApp.ts`

This is the main UI orchestration layer. It:
- loads and refreshes project/runtime state
- handles add/configure/remove project flows
- wires process actions like start/stop/restart
- manages terminal connection state
- coordinates history polling and selected project/service state

If a UI behavior feels stateful or workflow-related, this hook is the first place to inspect.

### `src/stores/devrunStore.ts`

Zustand store for the shared client-side model:
- projects and selected project/service
- history snapshots by service
- terminal entries and active terminal tab

### `src/lib/devrunApi.ts`

Thin client wrapper around the backend API. Change this when request/response shapes change.

### `src/components/*`

UI is split into focused components:
- sidebar and project selection
- project header and config actions
- command bar with service controls and `Open app`
- terminal panel
- history panel

The UI is intentionally driven by backend state rather than client-side process assumptions.

## Main Data Flow

### Add and configure a project

1. User adds a repo root.
2. Backend registers the project in `.devrun/projects.json`.
3. Backend may auto-seed one `web` service.
4. User refines saved services through `POST /api/project-config`.

### Start a service

1. UI calls `POST /api/process/start`.
2. `ProcessManager` resolves the target service and port.
3. It starts the child process and creates a new `runId`.
4. Runtime metadata becomes visible through `/api/state`.
5. History and logs accumulate while the process runs.
6. If a verified local web URL is found, `effectiveUrl` becomes available for `Open app`.

### Observe a running service

Use these surfaces together:
- `/api/state`: current snapshot
- `/api/history`: low-noise timeline
- `/api/logs`: verbose output
- `WS /ws`: terminal attach/replay

## Testing And Validation

The repo currently relies on:
- `scripts/smoke-api.mjs` for API/runtime smoke coverage
- `tests/*.spec.ts` for Playwright end-to-end behavior
- `npm run typecheck` for strict TypeScript validation

Behavior changes in lifecycle logic should usually be validated through the API layer, not only through UI clicks.

## Current Constraints

- local-first only
- no auth layer
- pipe-mode terminal runtime
- persistence is JSON files under `.devrun/`

Those constraints are intentional for the current MVP and shape many of the implementation choices above.
