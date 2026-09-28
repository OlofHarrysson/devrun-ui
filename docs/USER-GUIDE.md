# Terminal Manager User Guide

## What Terminal Manager Is

Terminal Manager is a shared local runtime for your AI agents. They usually register and
configure projects, run services, and inspect logs through the API while Terminal Manager
stays in the background. Its browser window can be closed without stopping services.

The human UI is mainly for checking and stopping accumulated services, cleaning up
registered projects, and occasionally starting or opening an app. Logs and history
remain available when you need them. The landing page is a project overview; terminals and history are inside project details.

## Core Concepts

### Project

A project is a repo root that Terminal Manager knows about.

### Service

A service is a named shell command inside that project, for example:
- `web` -> `npm run dev`
- `api` -> `uvicorn ...`
- `worker` -> `npm run worker`

Each service can also have:
- an optional working directory relative to the project root
- an optional preferred starting port

### Default Service

The default service is the one Terminal Manager uses when an API call omits `serviceName`.

### History vs Logs

- History is the low-noise lifecycle timeline: starts, stops, restarts, exits, and stdin commands.
- Logs are durable verbose terminal output from each service run.

### Port

Terminal Manager injects `PORT=<port>` before launch.

- If you set a `port`, Terminal Manager treats it as the preferred starting port.
- If that port is occupied or reserved, Terminal Manager assigns the next available port upward.
- If you do not set a port, Terminal Manager starts from its default web range.

This means one stopped service does not silently lose its port to another Terminal Manager-managed service.

### Effective URL

If a running service exposes a local web URL, Terminal Manager publishes it as `effectiveUrl`.

Use that value as the app URL. Terminal Manager prefers `localhost` when it can verify that `localhost` safely reaches the assigned port.

## First Run

1. Install dependencies:

```bash
npm install
```

2. Start Terminal Manager:

```bash
npm run dev
```

3. Open the app:

[http://localhost:4317](http://localhost:4317)

## Everyday use

### Set up through your agent

Ask your AI agent to register the project and configure its services in Terminal Manager.
Agents use `POST /api/projects` (or path-first start) and `POST /api/project-config`.
Registration may seed a `web` service from `package.json`; the agent checks that the
command, working directory, and port are correct. Manual configuration is not part
of the workspace UI.

### Find recent projects

The overview defaults to Running projects and Recently started order. Choose All to
include stopped projects. Search matches project names and paths. Recently started
uses the most recent service start in each project, including agent starts. Clicking
a project or service name opens its detail workspace; All projects returns home.

### Stop services you no longer need

Choose Longest running to order projects by their oldest currently running service.
Each named service shows its own duration and Stop button. Review the list and stop
only what you no longer need. Stopping keeps configuration for you or your agent to
start it later. A pending action waits for runtime confirmation; failures stay visible.
A project leaves the Running view when its last running service stops.

Last started and Running for are timestamps, not evidence of inactivity or battery
usage. Missing stopped-service start times are recovered from retained history when
possible; Start time unknown is shown otherwise. Terminal Manager does not automatically stop
old or quiet services. Closing the browser also leaves services running.

If state refresh fails, the overview labels cached state and disables service controls.
Use Retry or wait for polling to recover. The overview opens no terminal connections.

### Run and open

Use Start when stopped and Stop while running, including during startup.
Restart is available in project details. Open app appears when the service is ready and has a verified
URL. Actions are disabled while their request is pending.

The lifecycle label describes the process; the service tab describes its terminal
connection. A live connection alone does not mean the application is ready.

### Read output and history

Inside project details, the terminal shows live output or recent stopped logs. Toggle History to inspect
starts, stops, restarts, and exits. On desktop it sits beside output; on mobile it
covers output until closed. The terminal resizes when the available space changes.

Details exposes the full command, working directory, preferred port, run identity,
and log path. Use Open log there to inspect the full run log in your editor/default
app when a durable log is available. Individual history events expose run IDs under
Run details.

### Remove a project

Open project details, then the project actions menu (`···`) and choose Remove project, then confirm.
Removal requests stops for configured services and removes the project registration,
saved service configuration, and history. It does not delete the repository files.
Use Stop instead when you just want to end a run and keep the project ready for later.

## How Terminal Manager Chooses Ports

### Preferred port

If a service config includes a `port`, Terminal Manager starts its search there.

For example, if a web service asks for `3000` but `3000` is unavailable, Terminal Manager assigns `3001`, injects `PORT=3001`, and reports that assignment in state.

### Auto-assigned port

If a service has no `port`, Terminal Manager chooses one and keeps it reserved for that service.

That reservation stays stable across stop/start cycles, so:
- service A can stop
- service B can start
- service A can start later without unexpectedly colliding with B

## AI and Automation Use

Terminal Manager also exposes APIs for AI operators.

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

Ask your agent to update the real command, `cwd`, and optional port through
`POST /api/project-config`.

### Start fails with a port error

Either:
- another process is using that port, or
- another Terminal Manager service already reserves that port

Use a different preferred starting port, or remove the port and let Terminal Manager assign one.

### App starts, but the URL is wrong

Use the `Open app` button or the `effectiveUrl` from Terminal Manager APIs.

Terminal Manager normally publishes `localhost`; if IPv4/IPv6 loopback behaves inconsistently, it may fall back to a numeric loopback URL and show a warning.

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
