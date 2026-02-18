# Devrun Vision Brief

This document is the stable product direction for Devrun.
Implementation details (frameworks, libraries, internal APIs) can change.

## One-line vision
Devrun is the simplest local control center for running and observing multiple dev projects and their long-running services, with AI-ready access to what is happening.

## The problem
Developers working across 5-10 projects constantly context-switch between terminals, scripts, and tabs to start services, inspect logs, and recover from failures.
This is noisy, slow, and hard to hand off to AI tooling.
The second problem is that AIs and humans can't share one terminal and that it's hard for the AI to inspect the terminal to understand the project, especially when debugging.

## Product promise
From one interface, a developer should be able to:
- See all active projects at once.
- Start/stop/restart each service with one click.
- Open and switch between service terminals instantly.
- Extract the current system state and relevant logs in a format that AI can use.

## Design principles
- Local-first: run on localhost, no cloud dependency required.
- Fast path first: optimize for "I need this running now" workflows.
- Low ceremony: minimal setup, no container complexity required.
- Transparent process control: each service is a real shell process with real terminal IO.
- AI-compatible by default: state and logs are easy to fetch programmatically.

## Target users
- Solo builders and small teams running multiple local projects.
- AI-heavy workflows where assistants need quick operational context.
- Developers who want a GUI workflow without losing terminal power.

## Core UX outcomes
- A project can be added and made runnable in under 1 minute.
- A stopped service can be restarted in 1 click.
- A user can jump from one project/service terminal to another in under 2 clicks.
- A user (or AI agent) can capture current status + log tails in one API call.

## Product scope
In scope:
- Multi-project service management.
- Per-service terminal sessions.
- Basic log/state APIs for automation and AI.

Out of scope (for now):
- Cloud hosting and multi-user auth.
- Full production orchestration.
- Deep deployment lifecycle management.

## AI integration direction
Devrun should act as a reliable local runtime surface for AI assistants.
At minimum, assistants need endpoints to:
- Read current project/service state.
- Read log tails for selected services.
- Start/stop/restart services.
- Send terminal input when needed.

Later, we can add richer "operator" actions, but this base contract is the foundation.

## Success metrics (early)
- Setup friction: time to first project configured.
- Control efficiency: clicks/time to recover broken local stack.
- Context quality: usefulness of snapshots/log tails for AI-assisted debugging.
- Daily utility: frequency of use across active projects.

## Build strategy
Ship a small, useful core first.
Validate with real daily usage.
Only then add complexity (saved layouts, teams, access controls, richer observability).

## Consultancy handoff note
When making technical decisions, prioritize preserving the user outcomes above.
If a change improves implementation quality but weakens speed, simplicity, or AI readability, treat it as a tradeoff and justify it explicitly.
