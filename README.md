# devrun-ui

Local GUI to run long-lived dev services per project, with real PTY terminals in the browser.

## What it does
- Add multiple projects by path.
- Each project reads a `.devrun.yml` config file.
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

## Project config

Each managed project should include `.devrun.yml` at project root:

```yaml
name: chat-summary-viewer
services:
  - name: web
    cmd: npm run dev
  - name: api
    cmd: uvicorn app.main:app --reload
```

Optional service cwd (relative to project root):

```yaml
services:
  - name: worker
    cmd: npm run worker
    cwd: apps/worker
```

## API surface (MVP)

- `GET /api/state`
- `POST /api/projects`
- `DELETE /api/projects/:projectId`
- `POST /api/process/start`
- `POST /api/process/stop`
- `POST /api/process/restart`
- `POST /api/process/stdin`
- `GET /api/logs?projectId=...&serviceName=...&chars=4000`
- `POST /api/snapshot`
- `WS /ws?projectId=...&serviceName=...`

## Notes
- This is localhost tooling, no auth layer in MVP.
- Registry is stored at `~/.devrun/projects.json`.
