# Devrun design

## Intent

A calm local workspace for finding a project, running a service, and understanding
its output. Preserve the project → service → terminal flow and the shared human/AI
runtime contract. Prioritize scanability and useful status over dashboard decoration.

## Direction and ownership

[Made by Olof](https://www.madebyolof.com) is the selected **directional** reference
for charcoal surfaces, neutral text, warm gold-orange actions, DM Sans, and restrained
surface treatment. The palette is copied exactly from its local
`src/styles/global.css` on 2026-09-28; Devrun owns its adapted copy in
[`src/styles/olof-theme.css`](src/styles/olof-theme.css).
Do not carry over the personal portrait, Lora wordmark, hero animation, marketing
scale, or narrow editorial layout. Commands and output retain monospace type.
Local DM Sans font files and their OFL license live in `public/fonts/`.

The theme currently applies only to the development reference at
[/design](http://localhost:4317/design). The main workspace retains `corporate` until
the structural redesign is reviewed. This is an initial theme study, not an accepted
final workspace design. The reference is unavailable in production and has no API
or process effects. Its Start/Stop/Restart controls simulate state locally.

## Surface specifications

### DR-REFERENCE — implemented study

- Owner: `src/app/design/page.tsx`, `src/components/design/DesignReference.tsx`.
- Present direction, actual theme tokens, type samples, real controls, and next steps.
- Render production `CommandBar` and `HistoryPanel` with deterministic sample props.
- Offer current/new theme selection, stateful safe actions, and reset.
- Show the current control layout honestly; do not imply that recoloring completes the redesign.
- Fit 390px and 1440px viewports and retain visible keyboard focus.
- Coverage excludes the full live terminal, Open app/Open log actions, and configuration forms.

### DR-WORKSPACE — proposed next sprint

- Owners: `src/app/page.tsx`, `src/components/{Sidebar,ProjectHeader,CommandBar,TerminalPanel,HistoryPanel}.tsx`.
- Bound the desktop shell to the viewport; project list and output scroll independently.
- Use quiet project rows, readable names, search, and explicit ready/starting/error status.
- Combine project identity and service actions into one compact workspace header.
- Make Start primary when stopped; promote Open app when ready with a verified URL.
- Move Remove into a project menu and make history optional; retain visible failures.
- On phones, use a project chooser above the service view rather than placing every project before output.
- Apply the Olof theme and unify terminal colors only after capturing a matching baseline.
- Preserve service switching, logs, history, run identity, and all runtime API semantics.

## Evidence and workflow

[Initial review](docs/design-review.md) owns findings and recommendations.
[Harness integration](docs/design-harness.md) owns commands and evidence locations.
Follow the installed [workflow](tools/design-harness/modules/workflow/README.md) and
[reference guide](tools/design-harness/modules/workflow/design-reference.md).
Inspect original desktop/mobile captures. Passing checks establish behavior and
capture completeness; Olof decides visual acceptance.
