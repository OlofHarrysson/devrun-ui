# devrun-ui

Local GUI to run long-lived dev services per project, with real PTY terminals in the browser.

## Product direction

- Vision brief: [`docs/VISION.md`](docs/VISION.md)

## What it does
- Add multiple projects by path.
- Store per-project service config in Devrun (no per-repo YAML required).
- Start/stop/restart services with one click.
- Open terminal tabs for running services.
- Exposes API endpoints for AI tooling (`/api/state`, `/api/logs`, `/api/snapshot`, process control).

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
- `POST /api/projects`
- `POST /api/project-config`
- `DELETE /api/projects/:projectId`
- `POST /api/process/start`
- `POST /api/process/stop`
- `POST /api/process/restart`
- `POST /api/process/stdin`
- `GET /api/logs?projectId=...&serviceName=...&chars=4000`
- `POST /api/snapshot`
- `WS /ws?projectId=...&serviceName=...`

### Run identity

- Running services now expose a `runId` in `GET /api/state` and `/api/snapshot`.
- Stopped services retain `lastRunId` in `GET /api/state` when recent logs are available.
- `GET /api/logs` includes `runId` in the response and accepts optional `runId` query param to fetch only that run's logs.
- `WS /ws` accepts optional `runId` query param to ensure terminal attach targets the expected run.

## Testing

- End-to-end terminal reliability test:

```bash
npm run test:e2e
```

## Notes
- This is localhost tooling, no auth layer in MVP.
- Project registry is stored at `.devrun/projects.json`.
- Project service config is stored at `.devrun/project-configs.json`.
