# Devrun Vision Brief

This document owns product priorities. Current UI behavior is documented in the
[User Guide](USER-GUIDE.md); proposed surfaces live in [DESIGN.md](../DESIGN.md).

## One-line vision
Devrun is a shared local runtime for AI agents, with a lightweight human overview
for finding recent projects and stopping services that are no longer needed.

## Actual workflow
Olof is the primary user. His agents register and configure projects, start services,
and inspect state and logs through the API. Devrun usually runs in the background;
opening its window is occasional, not the primary interaction.

Services accumulate across projects and consume resources and battery. Olof opens
the UI mainly to stop things he no longer needs and clean up the project list.
Occasionally he wants to find a recent project and start it manually. He rarely reads
logs himself. A useful product can have low UI visit frequency and high agent usage.

## Priority user stories
1. **Review running work:** See which projects have running services and how long
   each service has been running, without opening their terminals.
2. **Stop accumulated services:** Identify older runs and stop the services Olof
   chooses, while keeping project configuration available for next time.
3. **Return to recent work:** Find recently started projects, optionally filter to
   running projects, and manually start a stopped service when needed.
4. **Clean the registry:** Remove projects no longer wanted in Devrun. Distinguish
   removing a registration from stopping a service; do not delete repository files.
5. **Operate through an agent:** Configure, control, and debug services reliably
   through the same runtime APIs, without requiring an open UI.
6. **Inspect when necessary:** Keep terminal output, history, readiness, and run
   identity accessible within a project as secondary human workflows.

## Design principles
- Agent-first operation; occasional human oversight and cleanup.
- Local-first, low ceremony, and no required cloud dependency.
- Put running services, recency, and stop controls ahead of terminal detail in the
  next overview. Preserve the current workspace for inspection.
- Name timestamps precisely: last started and running duration are observable;
  neither establishes last use or inactivity. Logs and API polling are not proof
  that an app is being used.
- Keep resource-saving decisions manual until a separate inactivity policy is
  agreed. Do not silently stop old services or claim measured battery savings.
- Keep stale/unknown state visible so cleanup decisions use trustworthy data.

## Next UX proposal — not implemented
A project overview with All / Running filtering, recent-start ordering, and a
longest-running sort for cleanup. Show named running services, duration, and direct
Stop controls; provide Start for stopped services and Open app where available.
Project details retain logs and history. See DR-OVERVIEW in [DESIGN.md](../DESIGN.md).

Define recency from actual service starts, including agent-initiated starts, rather
than UI visits or registration dates. Validate historical timestamp availability
across Devrun restarts before promising durable recent ordering; show unknown times
honestly. Filtering and sorting are independent controls.

## Scope and guardrails
Keep multi-project service management, shared process/state/history/log APIs, and
per-service output. Keep manual configuration forms, embedded AI chat, elaborate
observability dashboards, automatic idle shutdown, and blanket stop-all behavior
out of this next iteration. Bulk selected stopping can follow if individual stops
prove too slow. Cloud hosting, multi-user auth, and production orchestration remain
out of scope.

## Success criteria
- Agents can run and inspect services without an open browser or human setup forms.
- A short UI visit is enough to identify and stop unwanted running services.
- Recent work is easy to find even among many registered projects.
- Stopping leaves configuration intact for a later start.
- Old or quiet services are never falsely presented as known to be unused.
- Measure task completion and agent reliability, not time spent in the UI.

## Build strategy
Keep the approved visual theme. Prioritize the overview and cleanup workflow over
further terminal polish or handoff features. Validate with Olof's real registry and
short cleanup sessions before expanding features. Preserve existing process APIs.
