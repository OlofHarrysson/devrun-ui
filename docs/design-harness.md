# Design Harness integration

Registry id: `devrun-ui`. Installed at `tools/design-harness`, with workflow,
capture, geometry, and review from a committed source revision. The authoritative
version/hash/validation record is `tools/design-harness/installation.json`.
The source is [Design Harness](../../../design-harness/README.md); updates follow
its [maintenance guide](../../../design-harness/docs/maintenance.md).
Runtime does not depend on that checkout. Keep local adaptations outside `tools/`.

## Run

Use the existing Devrun development instance; do not start a second process manager
against the same `.devrun` state. The current URL is `http://localhost:4317`.
Run the shared-terminal-hub bootstrap first if availability is unknown. The design
commands never start or stop a server.

```sh
npm run design:capture -- before-workspace
npm run design:capture -- after-workspace
npm run design:review -- before-workspace after-workspace
npm run design:validate
npm run typecheck:ui
```

Set `DESIGN_BASE_URL` when targeting a different verified development URL. Node 22+
and the existing Playwright Chromium installation are required. A production server
returns 404 for `/design`, so it is not a valid full design-validation target.

`scripts/design.mjs` owns browser lifecycle, fixtures, assertions, selectors, and
snapshot selection. Captures use the real `/` application with intercepted APIs
and blocked service WebSockets. Data is explicitly simulated; no mutation request
is allowed through. The reference imports real components but has no network effects.
No live process reliability is claimed by these checks.

The adapter captures stopped, empty, and configuration-error workspace states,
plus history open, the theme reference and controls under both themes, at 1440×900 and 390×844.
It checks demo start/stop/restart/reset, browser errors, and reference overflow.
Workspace width and height must fit the viewport; the reference must have no
horizontal overflow. `npm run test:ui` additionally checks 33-project lists, long
paths, 320/390/1024/1440px widths, lifecycle actions, history resizing, removal, and
service switching. Its temporary real service validates streaming/start/stop/restart.

## Artifacts

Immutable snapshots: `artifacts/design/<name>/snapshot.json` with adjacent original
PNG/JSON/Markdown records. Failed runs retain diagnostics but publish no passing
snapshot. The validation command also builds a same-snapshot comparison to prove
review integration; this is explicitly not a before/after design change.

`design:review` accepts optional target/state, for example:

```sh
npm run design:review -- before-workspace after-workspace controls reference
```

Its HTML is a conversation-viewer fragment, not a standalone page. Present it using
the conversation visualization workflow. Compare matching target/state/viewports;
include page context when reviewing a cropped control. Baselines contain synthetic
paths and logs. Live audit screenshots are local/ignored because they can contain
personal project information.

## Reference and maintenance

[Design intent](../DESIGN.md) owns the reference classification and accepted decisions.
The development reference is `/design`; owners are `src/app/design/`,
`src/components/design/DesignReference.tsx`, and `src/styles/olof-theme.css`.
Its demo has a reset button and theme selector. Maintain it with component changes;
follow the installed [reference guide](../tools/design-harness/modules/workflow/design-reference.md).

Update with the source installer and run `npm run design:validate` through its
validation argument. Do not hand-edit managed files. Repeating the same installation
without a validation command must be a no-op. Revert the scoped design setup commit
to remove this adoption, preserving unrelated runtime work.
