# devrun-ui

Local GUI to run long-lived dev services per project, with real PTY terminals in the browser.

## Product direction

- Vision brief: [`docs/VISION.md`](docs/VISION.md)

## What it does
- Add multiple projects by path.
- Store per-project service config (including `defaultService`) in Devrun (no per-repo YAML required).
- Optional per-service `port` can be configured explicitly.
- Start/stop/restart services from a top command bar.
- Auto-open terminal tabs per service (live if running, read-only recent logs if stopped).
- Service tabs are project-scoped: select a project first, then switch between that project's services.
- Compact history panel shows recent per-service lifecycle/command events alongside the terminal.
- Exposes API endpoints for AI tooling (`/api/capabilities`, `/api/state`, `/api/history`, `/api/logs`, `/api/snapshot`, process control).
- `state`, `history`, and `logs` expose structured runtime metadata (`status`, `ready`, `terminalMode`, `ptyAvailable`, `warnings`, `effectiveUrl`, `port`).

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

## UI stack

- Next.js App Router (`src/app/layout.tsx`, `src/app/page.tsx`)
- React 19
- Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/postcss`)
- daisyUI v5
- Zustand store for UI state (`src/stores/devrunStore.ts`)
- App logic split into typed hooks/components (`src/hooks`, `src/components`, `src/lib`)
- Shared UI types in `src/types/ui.ts`
- Runtime/backend code grouped under `src/backend`
- Single global stylesheet: `src/styles/main.css` (base/theme/fonts only)
- Component styling is done in Tailwind/daisy class names in `src/components/*.tsx`.
- Active daisy theme: `corporate`.

## Project config (simple mode)

- Devrun stores service config in:
  - `.devrun/projects.json`
  - `.devrun/project-configs.json`
- No `.devrun.yml` is required in managed projects.
- On project add/startup, Devrun tries to auto-seed one `web` service from `package.json`:
  - `npm run dev` if a `dev` script exists
  - otherwise `npm run start` if a `start` script exists
- You can override via the **Configure** button in the UI.
- Each project has a `defaultService`; API calls can omit `serviceName` and target this service automatically.
- If a service has configured `port`, Devrun injects `PORT=<port>` before launch.
- Configured ports are strict: if the port is already taken, start/restart returns `409` instead of silently rolling to another port.
- Devrun persists owned child runs and performs an orphan cleanup sweep on startup.
- You can trigger manual cleanup via `POST /api/process/cleanup-orphans` if runtime state becomes desynced.
- Devrun injects `NODE_OPTIONS=--localstorage-file=<...>` when missing, with files stored under `.devrun/runtime/localstorage/` so transient localStorage artifacts stay out of managed project repos.

Service `cwd` and `port` are optional:

```yaml
services:
  - name: worker
    cmd: npm run worker
    cwd: apps/worker
    port: 4010
```

## Default seeded projects

On startup, Devrun attempts to add these projects automatically (if they exist on disk):

- `/Users/olof/git/codex-projects/devrun-ui`
- `/Users/olof/git/youtube-looper`
- `/Users/olof/git/bluesky-scheduler`
- `/Users/olof/git/codex-projects/chat-summary-viewer-mvp`

## API surface (MVP)

- `GET /api/state`
- `GET /api/capabilities`
- `POST /api/projects`
- `POST /api/project-config` (update services/defaultService for an existing project)
- `DELETE /api/projects/:projectId`
- `POST /api/process/start` (auto-registers an existing directory when called with `projectPath`/`cwd` for an unknown project)
- `POST /api/process/stop`
- `POST /api/process/restart`
- `POST /api/process/stdin`
- `POST /api/process/cleanup-orphans`
- `GET /api/history?projectId=...|projectPath=...|cwd=...&serviceName=<optional>&afterSeq=0&limit=25`
- `GET /api/logs?projectId=...|projectPath=...|cwd=...&serviceName=<optional>&chars=4000`
- `POST /api/snapshot`
- `WS /ws?projectId=...&serviceName=...`
- `WS /ws/client-logs?projectId=...&serviceName=...&runId=...`

### Project config endpoint

Use `POST /api/project-config` to update project display name, services, and `defaultService` for an existing project.

```bash
curl -s -X POST http://localhost:4317/api/project-config \
  -H "content-type: application/json" \
  -d '{
    "projectId":"<PROJECT_ID>",
    "name":"My project",
    "defaultService":"web",
    "services":[
      {"name":"web","cmd":"npm run dev","cwd":".","port":3000},
      {"name":"worker","cmd":"npm run worker","cwd":"apps/worker"}
    ]
  }' | jq
```

Notes:
- `projectId` is required (`404` if project does not exist).
- `services` must contain at least one valid `{ name, cmd }` entry.
- Service names must be unique (case-insensitive).
- `defaultService` must match one configured service name.
- `port`, when set, must be an integer from `1` to `65535`.
- If command starts with `PORT=<n>`, explicit `port` must match `<n>`.

### Run identity

- Running services now expose a `runId` in `GET /api/state` and `/api/snapshot`.
- Stopped services retain `lastRunId` in `GET /api/state` when recent logs are available.
- Runtime snapshots expose `status` (`starting|ready|stopped|error`) and `ready` to avoid log-scraping for readiness.
- `GET /api/logs` includes `runId` in the response and accepts optional `runId` query param to fetch only that run's logs.
- `WS /ws` accepts optional `runId` query param to ensure terminal attach targets the expected run.
- `WS /ws/client-logs` requires `runId` and only accepts logs for the currently active run.

### Event history (low-noise)

- `GET /api/history` returns per-service event history with retention of the latest `100` events.
- Event types are: `start`, `stop_requested`, `restart_requested`, `stdin_command`, `exit`, `client_log`.
- `exit` events may include `data.replacedByRestart: true` when the old run is intentionally replaced during restart.
- Use this for workflow timeline and command context.
- Keep `GET /api/logs` for verbose service output (stdout/stderr tail).

### Browser client log bridge (dev)

- Managed services started in `NODE_ENV=development` receive bridge env vars:
  - `NEXT_PUBLIC_DEVRUN_LOG_BRIDGE_ENABLED=1`
  - `NEXT_PUBLIC_DEVRUN_LOG_BRIDGE_WS_URL`
  - `NEXT_PUBLIC_DEVRUN_PROJECT_ID`
  - `NEXT_PUBLIC_DEVRUN_SERVICE_NAME`
  - `NEXT_PUBLIC_DEVRUN_RUN_ID`
- Browser apps can forward logs via WS messages:
  - `{"type":"client_log_batch","entries":[{"level":"debug|log|info|warn|error","ts":"ISO-8601","message":"...","path":"...","source":"console|window_error|unhandledrejection","clientId":"..."}]}`
- Limits:
  - max `50` entries/message
  - max `2000` chars per text field
  - max `16KB` raw WS payload (oversized messages are ignored)

### AI polling recipe

1. Discover endpoints and constraints:

```bash
curl -s http://localhost:4317/api/capabilities | jq
```

2. Discover valid project IDs, default services, and runtime metadata:

```bash
curl -s http://localhost:4317/api/state | jq
```

3. (Optional) Update service config/default service by `projectId`:

```bash
curl -s -X POST http://localhost:4317/api/project-config \
  -H "content-type: application/json" \
  -d '{"projectId":"<PROJECT_ID>","services":[{"name":"web","cmd":"npm run dev"}],"defaultService":"web"}' | jq
```

4. Start by project path (no ID lookup and no service name required):

```bash
curl -s -X POST http://localhost:4317/api/process/start \
  -H "content-type: application/json" \
  -d '{"projectPath":"/Users/olof/git/youtube-looper"}' | jq
```

5. First history read (path-first, default service):

```bash
curl -s "http://localhost:4317/api/history?projectPath=/Users/olof/git/youtube-looper" | jq
```

6. Incremental polling (cursor-based):

```bash
curl -s "http://localhost:4317/api/history?projectPath=/Users/olof/git/youtube-looper&afterSeq=<NEXT_AFTER_SEQ>" | jq
```

7. Verbose logs (optionally scoped to a run):

```bash
curl -s "http://localhost:4317/api/logs?projectPath=/Users/olof/git/youtube-looper&chars=8000" | jq
# Optional run scoping:
# curl -s "http://localhost:4317/api/logs?projectPath=/Users/olof/git/youtube-looper&runId=<RUN_ID>&chars=8000" | jq
```

## Codex Skill

- Skill name: `shared-terminal-hub-operator`
- Purpose: help AI agents operate Devrun reliably (discover targets, run actions, poll history, inspect logs, verify outcomes).
- Skill files:
  - `$CODEX_HOME/skills/custom/shared-terminal-hub-operator/SKILL.md`
  - `$CODEX_HOME/skills/custom/shared-terminal-hub-operator/references/devrun-api.md`
- Recommended usage in agent prompts: `Use $shared-terminal-hub-operator`.

## Testing

- Fast API smoke test (recommended during iteration):

```bash
npm run smoke:api
```

- End-to-end terminal reliability test:

```bash
npm run test:e2e
```

- Full validation (smoke + e2e):

```bash
npm run test:all
```

## Notes
- This is localhost tooling, no auth layer in MVP.
- Project registry is stored at `.devrun/projects.json`.
- Project service config is stored at `.devrun/project-configs.json`.
