# devrun-ui

Local GUI to run long-lived dev services per project, with real PTY terminals in the browser.

## Product direction

- Vision brief: [`docs/VISION.md`](docs/VISION.md)

## What it does
- Add multiple projects by path.
- Store per-project service config in Devrun (no per-repo YAML required).
- Start/stop/restart services from a top command bar.
- Auto-open terminal tabs per service (live if running, read-only recent logs if stopped).
- Service tabs are project-scoped: select a project first, then switch between that project's services.
- Compact history panel shows recent per-service lifecycle/command events alongside the terminal.
- Exposes API endpoints for AI tooling (`/api/capabilities`, `/api/state`, `/api/history`, `/api/logs`, `/api/snapshot`, process control).

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Open app:

[http://localhost:4317](http://localhost:4317)

## Project config (simple mode)

- Devrun stores service config in:
  - `.devrun/projects.json`
  - `.devrun/project-configs.json`
- No `.devrun.yml` is required in managed projects.
- On project add/startup, Devrun tries to auto-seed one `web` service from `package.json`:
  - `npm run dev` if a `dev` script exists
  - otherwise `npm run start` if a `start` script exists
- You can override via the **Configure** button in the UI.

Service `cwd` is optional (relative to project root):

```yaml
services:
  - name: worker
    cmd: npm run worker
    cwd: apps/worker
```

## Default seeded projects

On startup, Devrun attempts to add these projects automatically (if they exist on disk):

- `/Users/olof/git/youtube-looper`
- `/Users/olof/git/bluesky-scheduler`
- `/Users/olof/git/codex-projects/chat-summary-viewer-mvp`

## API surface (MVP)

- `GET /api/state`
- `GET /api/capabilities`
- `POST /api/projects`
- `POST /api/project-config`
- `DELETE /api/projects/:projectId`
- `POST /api/process/start`
- `POST /api/process/stop`
- `POST /api/process/restart`
- `POST /api/process/stdin`
- `GET /api/history?projectId=...&serviceName=...&afterSeq=0&limit=25`
- `GET /api/logs?projectId=...&serviceName=...&chars=4000`
- `POST /api/snapshot`
- `WS /ws?projectId=...&serviceName=...`

### Run identity

- Running services now expose a `runId` in `GET /api/state` and `/api/snapshot`.
- Stopped services retain `lastRunId` in `GET /api/state` when recent logs are available.
- `GET /api/logs` includes `runId` in the response and accepts optional `runId` query param to fetch only that run's logs.
- `WS /ws` accepts optional `runId` query param to ensure terminal attach targets the expected run.

### Event history (low-noise)

- `GET /api/history` returns per-service event history with retention of the latest `100` events.
- Event types are: `start`, `stop_requested`, `restart_requested`, `stdin_command`, `exit`.
- Use this for workflow timeline and command context.
- Keep `GET /api/logs` for verbose service output (stdout/stderr tail).

### AI polling recipe

1. Discover endpoints and constraints:

```bash
curl -s http://localhost:4317/api/capabilities | jq
```

2. Discover valid project/service IDs:

```bash
curl -s http://localhost:4317/api/state | jq
```

3. First history read:

```bash
curl -s \"http://localhost:4317/api/history?projectId=<PROJECT_ID>&serviceName=<SERVICE_NAME>\" | jq
```

4. Incremental polling (cursor-based):

```bash
curl -s \"http://localhost:4317/api/history?projectId=<PROJECT_ID>&serviceName=<SERVICE_NAME>&afterSeq=<NEXT_AFTER_SEQ>\" | jq
```

## Testing

- End-to-end terminal reliability test:

```bash
npm run test:e2e
```

## Notes
- This is localhost tooling, no auth layer in MVP.
- Project registry is stored at `.devrun/projects.json`.
- Project service config is stored at `.devrun/project-configs.json`.
