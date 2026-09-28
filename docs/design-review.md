# Product and UI review — 28 September 2026

## Product direction after daily-use review

Olof reports that Devrun primarily serves his agents in the background. His UI visits
are mostly for stopping accumulated services and cleaning up projects, with occasional
manual starts and little direct log reading. The next priority is the proposed recent
project/running-service overview in [DESIGN.md](../DESIGN.md#dr-overview--proposed-not-implemented).
[VISION.md](VISION.md) owns these current priorities. The delivered terminal workspace
below remains useful for inspection; it is not the intended primary landing workflow.

## Delivered workspace

The main page now uses the approved charcoal/orange palette and local DM Sans.
The desktop sidebar is searchable and scrolls independently. Mobile uses a project
chooser. Service actions follow lifecycle state; project removal lives in a secondary
menu. Agents own project registration and configuration through the existing API.
History is optional, with full command/run/log metadata behind Details. The terminal
uses shared colors and refits when its container changes.

Verification: the 10-test UI/lifecycle suite passed, plus a focused mobile-history
keyboard test. Layout coverage includes 33 projects and long paths at 320, 390, 1024,
and 1440px widths. A temporary real service passed start/stop/restart, run identity,
history, terminal streaming, and stopped-log recovery; cleanup left no test projects.
Frontend and backend typechecks passed. The final Harness snapshot has 18 records
including mobile history replacing output, with no workspace overflow. The live Made
by Olof service was inspected read-only on desktop and mobile.

Before/after evidence: `artifacts/design/workspace-before/` and
`artifacts/design/workspace-final/`. Original PNGs were visually inspected. Header/action
review crops are unscaled derivatives of those originals, located using captured
geometry and retaining parent-record provenance. Live screenshots are local and ignored.

The real lifecycle check exposed a UI race: a service could stop after the action’s
immediate state fetch, leaving a disconnected tab after its socket closed. State
reconciliation now restores stopped status and recent logs for disconnected/connecting
entries as well as live ones. Backend process logic and API semantics were not changed.

Tradeoffs: history and full metadata require opening a panel. Manual Add/Configure
controls are intentionally absent; their existing hook helpers remain unused. Original
pending log-opening UI support was integrated into Details; pre-existing backend work
was left untouched. No production build or full backend smoke suite was run against
the shared development instance. Browser checks used Chromium, not physical phones.

## Initial setup scope

Design Harness is installed; `/design` presents the Made by Olof theme through real
Devrun controls. This pass establishes a review workflow and a concrete next sprint.
The initial setup left the main workspace unchanged. Existing log-opening, port, and
runtime changes were inspected and preserved.

Inspected the live app on localhost:4317, Made by Olof in a browser, current source,
and deterministic desktop/mobile captures. The reference source was the local Made
by Olof checkout and its canonical `DESIGN.md`/`src/styles/global.css`.

## Initial findings and decisions

### 1. Make the workspace fit the work — addressed

**Observed:** The live registry has 33 projects. At 1440×900 the document grows to
about 1612px, stretching the terminal and history with the sidebar. At 390px wide,
the live page has a 1131px document width. A synthetic 12-project stopped-service
fixture reproduces 228px horizontal overflow (618px document); a configuration-error
fixture produces 5px overflow. Empty state fits horizontally.

Sources: `src/app/page.tsx`, `Sidebar.tsx`, `ProjectHeader.tsx`, `CommandBar.tsx`,
`TerminalPanel.tsx`. The shell uses min-height rather than bounded height; sidebar
rows accumulate; header content cannot reliably shrink; the command row includes a
300px minimum and long log paths. History permanently takes 320px on wide screens.

**Recommendation:** A viewport-height desktop workspace, independently scrolling
project list/output, compact project/service header, and optional history. Add
project search and a mobile chooser so users can reach output without scrolling past
every project. Fix long-content shrink constraints. Preserve the current service model.

**Tradeoff:** Hiding history saves output space but adds a step to consult the timeline.
Keep its entry visible and preserve the service selection while opening it.

Evidence: `artifacts/design/initial/live-desktop.png`, `live-mobile.png`, and
`artifacts/design/baseline/workspace-stopped-{desktop,mobile}.{png,json}`.
Live evidence is intentionally local and ignored; deterministic captures are regenerable.

### 2. Give controls and status a clear hierarchy — addressed

**Observed:** Add Project, selected project, selected service, and Start share a strong
accent. Start, Stop, and Restart are all enabled regardless of lifecycle. Remove is
always next to Configure. Long log paths, ports, run identifiers, and colored event
badges compete with the useful output. “Running” project counts test only a boolean;
service readiness and terminal connection state are distinct concepts shown separately.

**Recommendation:** Use the Olof charcoal/gray system with orange reserved mainly for
primary action and focus. Use quieter selection styling, a status-aware action group,
and an overflow menu for project maintenance. Explain readiness separately from a
connected log stream. Put the log path, requested port, and run identifiers in details.
Keep errors visible. Unify the xterm palette with the surrounding canvas.

**Tradeoff:** Less metadata at a glance; inspect-details and Open log must remain easy
to reach. A dark theme alone does not resolve the action hierarchy.

**Initial setup:** Scoped theme and font adoption in `/design`, real component demo,
current/theme selector, safe start/stop/restart/reset, and clear focus. Visual review
caught and corrected low-contrast secondary outline buttons and neutral soft badges.
The theme retains the source’s main hues and adapts roles for Devrun controls.

### 3. Keep configuration agent-led — founder direction

Olof configures services through AI agents using the API and is the primary user.
The human interface should prioritize observing, running, opening, and removing
projects. Do not build the previously proposed configuration form. Keep Remove in
a secondary menu and preserve API configuration. The workspace removes the
manual Configure action; it is not central.

## Palette follow-up

The approved palette uses five everyday colors (canvas, surface, primary text,
secondary text, orange) plus green/red for success/error states. Body and secondary
text share one neutral; border/hover shades are derived, warnings reuse orange, and
text on orange uses canvas. Starting uses neutral text in the workspace.
Olof approved the proposal, which is now applied to the main workspace.
Compared `palette-before` and `palette-after` captures at desktop/mobile sizes,
checked the original PNGs, validated the comparison controls, and passed frontend
TypeScript checks. The body/secondary text merge makes body copy slightly quieter.

## Initial repository assessment

- Next.js App Router, React 19, Tailwind 4, daisyUI 5, Zustand, and xterm already give
  the project sufficient UI foundations. Reuse components and add the custom theme.
- The backend exposes state, readiness, history, logs, run identity, and verified app
  URLs. The design should make those existing capabilities easier to understand.
- Five main presentation components give the layout change a clear boundary. The
  app hook is 1071 lines and combines selection, terminal lifecycle, and prompt forms;
  leave configuration alone while changing the layout rather than broadly refactoring it.
- `npm run typecheck` checked only backend TypeScript. Added `typecheck:ui` so future
  design work can explicitly check the frontend without triggering a build.
- Existing process-reliability tests remain separate. The design adapter mocks data
  on the real page and never controls the shared runtime. No additional framework or
  browser package was needed.
- Main CSS contains older daisy color-variable expressions, and xterm hardcodes a
  separate navy background/font. Resolve those in the theme rollout, not by importing
  the portfolio stylesheet wholesale.

## Workspace acceptance criteria

At desktop/laptop/mobile widths, show the selected service and its main action without
horizontal overflow; keep long names and paths readable through disclosure. Test a
33-project list, stopped/starting/ready/error states, no project, and invalid config.
Verify service switching, Open app, logs, history, and keyboard navigation. Present
matching before/after full-page and detail captures. Do not change process APIs.

## Initial setup validation and limits

The delivered workspace validation above supersedes this initial coverage.

- Frontend and backend TypeScript checks passed.
- Twelve named captures per successful run: desktop/mobile workspace stopped, empty,
  configuration error; reference; Olof controls; current-theme controls.
- Reference start/stop/restart/reset and keyboard activation checked without API writes;
  no browser runtime errors in successful runs; reference has no horizontal overflow.
- Harness geometry/evidence records and the comparison builder validated through the
  installer; installation status is recorded in `installation.json`.
- Original PNGs inspected. Automation does not constitute approval of final visual taste.
- No full backend smoke/e2e run: runtime logic is unchanged by this work. No new dev
  server was started or existing service restarted. Production visibility is guarded
  in the route source; a separate production build/404 check was not run on this shared
  development instance.
- Ready/starting/failed service fixtures, real terminal streaming, full accessibility
  testing, and phone browser testing remain outside this initial setup.

## Learning

The useful first result is structural evidence: a large real registry exposes problems
that a short fixture can miss. Carry a 33-project stress state into the workspace
redesign. Shared theme values still need product-specific role checks. No global
methodology or personalization changes are warranted by this pass.

The implementation also showed why lifecycle validation needs a real service: fixture
states did not expose the socket-close/state-poll race. Retain the isolated lifecycle
check alongside responsive fixtures for future UI work.
