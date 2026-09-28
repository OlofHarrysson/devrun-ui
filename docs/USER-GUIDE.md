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
- Logs are durable verbose terminal output from each service run.

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

## Everyday use

### Set up through your agent

Ask your AI agent to register the project and configure its services in Devrun.
Agents use `POST /api/projects` (or path-first start) and `POST /api/project-config`.
Registration may seed a `web` service from `package.json`; the agent checks that the
command, working directory, and port are correct. Manual configuration is not part
of the workspace UI.

### Find a project and service

Search project names or paths in the sidebar, then select a service tab.
On mobile, use the project chooser at the top. The sidebar scrolls independently
so larger registries do not push the terminal off screen.

### Run and open

Use Start when stopped. While running, Restart and Stop are available, including
Stop during startup. Open app appears when the service is ready and has a verified
URL. Actions are disabled while their request is pending.

The lifecycle label describes the process; the service tab describes its terminal
connection. A live connection alone does not mean the application is ready.

### Read output and history

The terminal shows live output or recent stopped logs. Toggle History to inspect
starts, stops, restarts, and exits. On desktop it sits beside output; on mobile it
covers output until closed. The terminal resizes when the available space changes.

Details exposes the full command, working directory, preferred port, run identity,
and log path. Use Open log there to inspect the full run log in your editor/default
app when a durable log is available. Individual history events expose run IDs under
Run details.

### Remove a project

Open the project actions menu (`···`) and choose Remove project, then confirm.
The existing API removal behavior still applies; configuration remains agent-led.

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

Ask your agent to update the real command, `cwd`, and optional port through
`POST /api/project-config`.

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
