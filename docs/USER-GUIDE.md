# Devrun User Guide

## What Devrun Is

Devrun is a local control center for running and observing multiple dev projects from one place.

Instead of remembering which terminal tab belongs to which repo, you register a project once, define one or more named services, and then use Devrun to:
- start, stop, and restart services
- inspect recent lifecycle history
- read verbose terminal output
- open the verified app URL for a running web service

Devrun is built for both humans and AI agents. The UI and the APIs describe the same runtime state.

## Core Concepts

### Project

A project is a repo root that Devrun knows about.

### Service

A service is a named shell command inside that project, for example:
- `web` -> `npm run dev`
- `api` -> `uvicorn ...`
- `worker` -> `npm run worker`

Each service can also have:
- an optional working directory relative to the project root
- an optional preferred starting port

### Default Service

The default service is the one Devrun uses when an API call omits `serviceName`.

### History vs Logs

- History is the low-noise lifecycle timeline: starts, stops, restarts, exits, and stdin commands.
- Logs are the verbose terminal output from the running or most recent service run.

### Port

Devrun injects `PORT=<port>` before launch.

- If you set a `port`, Devrun treats it as the preferred starting port.
- If that port is occupied or reserved, Devrun assigns the next available port upward.
- If you do not set a port, Devrun starts from its default web range.

This means one stopped service does not silently lose its port to another Devrun-managed service.

### Effective URL

If a running service exposes a local web URL, Devrun publishes it as `effectiveUrl`.

Use that value as the app URL. Devrun prefers `localhost` when it can verify that `localhost` safely reaches the assigned port.

## First Run

1. Install dependencies:

```bash
npm install
```

2. Start Devrun:

```bash
npm run dev
```

3. Open the app:

[http://localhost:4317](http://localhost:4317)

## First-Time UI Flow

### 1. Add a project

Click `Add Project`.

Devrun asks for:
- project root path
- optional display name

If the repo has a `package.json` with `dev` or `start`, Devrun may auto-seed one `web` service for you.

### 2. Configure services

Select the project and click `Configure`.

Devrun asks for:
- display name
- service name
- service command
- optional working directory
- optional port
- whether to add another service
- default service name

For many repos, the smallest useful setup is just:

```text
Service name: web
Command: npm run dev
Working directory: .
Port: optional preferred starting port, for example `3000` for a web app or `8080` for an API
```

### 3. Start a service

Select the service and click `Start`.

Devrun will:
- launch the command
- open a terminal tab for that service
- start recording history for that run
- surface runtime metadata such as `status`, `ready`, `port`, and `effectiveUrl`

### 4. Open the app

If the service is a web app and Devrun can verify its URL, the command bar shows `Open app`.

Use that button instead of manually typing a URL.

### 5. Inspect behavior

Use:
- the service tabs to switch between services
- the terminal panel for live output or recent stopped logs
- the history panel for start/stop/restart/exit context

## How Devrun Chooses Ports

### Preferred port

If a service config includes a `port`, Devrun starts its search there.

For example, if a web service asks for `3000` but `3000` is unavailable, Devrun assigns `3001`, injects `PORT=3001`, and reports that assignment in state.

### Auto-assigned port

If a service has no `port`, Devrun chooses one and keeps it reserved for that service.

That reservation stays stable across stop/start cycles, so:
- service A can stop
- service B can start
- service A can start later without unexpectedly colliding with B

## What the UI Tells You

### Sidebar

Shows:
- registered projects
- which project is selected
- how many services are running in each project

### Project Header

Shows:
- project name
- project root path
- `Configure` and `Remove` actions

### Command Bar

Shows:
- selected service name
- lifecycle status
- configured command
- current port
- `Open app` when available
- `Start`, `Stop`, and `Restart`

### Terminal Panel

Shows:
- one tab per service in the selected project
- the connection state for each tab
- the active terminal output
- recent logs for stopped services

### History Panel

Shows:
- lifecycle events for the selected service
- low-noise operational context without requiring log scraping

## AI and Automation Use

Devrun also exposes APIs for AI operators.

The usual flow is:
1. `GET /api/capabilities`
2. `GET /api/state`
3. `POST /api/process/start`
4. `GET /api/history`
5. `GET /api/logs`

Use `POST /api/project-config` to change saved services and `defaultService`.

## Troubleshooting

### Project added, but no service works

The auto-seeded `web` service may be wrong for that repo.

Fix it with `Configure` and set the real command, `cwd`, and optional port.

### Start fails with a port error

Either:
- another process is using that port, or
- another Devrun service already reserves that port

Use a different preferred starting port, or remove the port and let Devrun assign one.

### App starts, but the URL is wrong

Use the `Open app` button or the `effectiveUrl` from Devrun APIs.

Devrun normally publishes `localhost`; if IPv4/IPv6 loopback behaves inconsistently, it may fall back to a numeric loopback URL and show a warning.

### Service exits immediately

Check:
- terminal output
- history events
- project command
- working directory
- missing dependencies or env vars

### Runtime state looks stale after a crash

Use:

```bash
curl -s -X POST http://localhost:4317/api/process/cleanup-orphans | jq
```

## Current Limits

- Localhost-only MVP, no auth layer
- Pipe-mode runtime only
- Built around command-based local services

## Related Docs

- [README.md](/Users/olof/git/codex-projects/devrun-ui/README.md)
- [ARCHITECTURE.md](/Users/olof/git/codex-projects/devrun-ui/docs/ARCHITECTURE.md)
- [VISION.md](/Users/olof/git/codex-projects/devrun-ui/docs/VISION.md)
- [AGENTS.md](/Users/olof/git/codex-projects/devrun-ui/AGENTS.md)
