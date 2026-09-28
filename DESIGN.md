# Devrun design

## Intent

A calm local workspace for finding a project, running a service, and understanding
its output. Preserve the project → service → terminal flow and the shared human/AI
runtime contract. Prioritize scanability and useful status over dashboard decoration.
Olof is the primary user. Agents register and configure services through the API;
the human UI is for observing, running, opening, and removing projects. A manual
configuration form is not a product priority. Keep the API configuration contract.

## Direction and ownership

[Made by Olof](https://www.madebyolof.com) is the selected **directional** reference
for charcoal surfaces, neutral text, warm gold-orange actions, DM Sans, and restrained
surface treatment. The palette is adapted from its local
`src/styles/global.css`; Devrun owns its copy in
[`src/styles/olof-theme.css`](src/styles/olof-theme.css).
Do not carry over the personal portrait, Lora wordmark, hero animation, marketing
scale, or narrow editorial layout. Commands and output retain monospace type.
Local DM Sans font files and their OFL license live in `public/fonts/`.

The approved theme applies to the workspace and the development reference at
[/design](http://localhost:4317/design). The reference is unavailable in production
and has no API or process effects. Its controls simulate state locally.

## Approved palette

Five everyday colors: canvas `#101114`, surface `#1c1e23`, primary text `#f2f3f5`,
secondary text `#a1a7b0`, and orange `#f6b743`. Green `#9ad5bd` and red `#efaaa3`
are reserved for meaningful success/error states. Derive divider and hover shades
from these colors; use canvas for text on orange. Body and secondary copy share one
text color. A warning may reuse orange; starting is informational and should be
neutral in the redesigned workspace. Keep explicit status text, never color alone.
Olof approved this palette on 28 September 2026.

## Surface specifications

### DR-REFERENCE — implemented study

- Owner: `src/app/design/page.tsx`, `src/components/design/DesignReference.tsx`.
- Present direction, actual theme tokens, type samples, real controls, and workspace principles.
- Render production `CommandBar` and `HistoryPanel` with deterministic sample props.
- Offer legacy/approved theme selection, stateful safe actions, and reset.
- Keep the shared controls aligned with the implemented workspace.
- Fit 390px and 1440px viewports and retain visible keyboard focus.
- Coverage excludes the full live terminal, Open app/Open log actions, and configuration forms.

### DR-WORKSPACE — implemented

- Owners: `src/app/page.tsx`, `src/components/{Sidebar,ProjectHeader,CommandBar,TerminalPanel,HistoryPanel}.tsx`.
- Bound the desktop shell to the viewport; project list and output scroll independently.
- Use quiet project rows, readable names, search, and explicit ready/starting/error status.
- Combine project identity and service actions into one compact workspace header.
- Make Start primary when stopped; promote Open app when ready with a verified URL.
- Keep Remove available in a project menu. Configuration belongs to agents via the API;
  do not build a manual configuration form. Make history optional; retain visible failures.
- On phones, use a project chooser above the service view rather than placing every project before output.
- Apply the Olof theme; read terminal canvas, text, and selection colors from its tokens.
- Refit the terminal when its container changes, including history opening/closing.
- Hide manual Add/Configure controls; empty states explain agent-led setup.
- Stop remains available while starting. Hide redundant Start for running services;
  show Restart only while running. Disable controls while an action is pending.
- Preserve service switching, logs, history, run identity, and all runtime API semantics.

## Evidence and workflow

[Design review](docs/design-review.md) owns findings, decisions, and validation.
[Harness integration](docs/design-harness.md) owns commands and evidence locations.
Follow the installed [workflow](tools/design-harness/modules/workflow/README.md) and
[reference guide](tools/design-harness/modules/workflow/design-reference.md).
Inspect original desktop/mobile captures. Passing checks establish behavior and
capture completeness; Olof decides visual acceptance.
