# Developing a project's design language

This is a method for reasoning about design. It supplies no palette, font,
spacing scale, component library, or mandatory document layout. The consumer's
own design documentation and implementation remain authoritative for its choices.

Start with the user need and information priority. Identify the job a visual
choice must do: distinguish an action, group related content, establish reading
order, or communicate state. Give recurring jobs meaningful roles within that
project. A token can express a role; a component applies it in context. Review
the rendered result before treating the choice as established.

The useful sequence is **need → job → role → token → component → evidence**.
Not every choice needs every step or a new token. A one-off composition can stay
local. Promote a choice into the project's design system when its recurring job
is explainable; duplicated numbers alone do not establish a reusable concept.
Prefer a name that explains purpose when a semantic role is intended. Keep
primitive palette values distinct from roles if that distinction helps the project.

## Reduce the work of understanding

Judge simplicity by the effort to understand and complete the task, not by how
little is visible. Available data does not all deserve a place on screen;
hiding useful information can also create work. These are design judgments,
not a formula or a universal component recipe.

- **Prioritize.** Start with the current question, the necessary answer and the
  next useful action. Keep consequential state and errors visible. Remove
  decorative eyebrows, repeated summaries and explanations of obvious controls.
- **Make relationships visible.** Use hierarchy, proximity, alignment and
  consistent treatments to show what belongs together and what matters most.
  Choose a representation that makes the content easier to recognize or compare:
  concise text, a visual or a purpose-built component can each do this job.
  More icons, cards or borders do not automatically make meaning clearer.
- **Justify boundaries.** Start grouping with spacing, alignment and typography.
  A component does not need a card around it. Add a border or surface only when
  it communicates a useful boundary or state that the layout cannot convey as
  clearly. Nested surfaces need a distinct additional job; avoid framing every
  child inside an already grouped object. Do not replace excess cards with excess
  dividers. Keep useful input, selection and focus treatments visible.
- **Make actions recognizable.** Put frequent actions near the object they affect.
  Use familiar controls with predictable outcomes. An icon helps when its meaning
  is recognizable in context; retain a visible label when it would require guessing.
  Component states should communicate selection, progress and the result of acting.
- **Disclose for a reason.** Expand optional detail beside its context; switch a
  component's view when people need one perspective at a time; use a menu for
  occasional commands. Keep information together when people need to compare it.
  Nested submenus are a poor default for simplifying a surface: they add searching
  and navigation. A clear direct route to detail is usually easier to inspect.
  A short answer can lead to depth without making every level a separate hurdle.
  Opening a detail should usually deliver that detail immediately, rather than
  reveal another chooser. Replacing a submenu with tabs does not remove the cost
  of an unnecessary intermediate step.
- **Keep the route usable.** Give hidden content a clear, predictable entry point
  and preserve orientation when it opens. Hover may reveal secondary controls,
  with keyboard and touch access too; it cannot be the only way to discover an
  essential action. Show focus, selected state and a clear way back or to dismiss.

The foundations are [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/),
[visual hierarchy and grouping](https://www.nngroup.com/articles/principles-visual-design/),
[Norman's signifiers](https://jnd.org/signifiers-not-affordances/) and
[progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
Use [established component guidance](https://design-system.service.gov.uk/components/tabs/)
and [accessibility requirements](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
to resolve the selected interaction, rather than copying a pattern everywhere.

In review, ask whether a person can identify what matters, predict the next action
and get the needed detail without searching or remembering hidden information.
Inspect the default and used states; fewer words or clicks alone do not prove
lower cognitive load.

## Review the composition

When reviewing a surface, consider these questions together:

- Does hierarchy make the important content and next action easy to find?
- Do grouping, spacing, alignment, and repetition explain relationships?
- Is typography readable for the actual content and available width?
- Do colors, boundaries, and interaction states remain distinguishable in context?
- Does the composition work with long, empty, focused, and narrow-screen states?

Measurements help investigate these questions. They cannot choose a brand,
establish visual taste, or approve a composition. Selected color-pair ratios do
not establish that those colors are used together on real elements. Pair numeric
reports with actual screenshots, behavior checks, and human review.

Keep exact values in the project's existing token/CSS owner. Its design notes
explain intent and rationale; accepted specifications record local decisions and
useful evidence. Link those owners instead of duplicating their values throughout
documentation. Changing a design rule is legitimate when reviewed evidence supports
it; reconcile the rule after acceptance instead of preserving a bad choice forever.

Shared Harness updates maintain this method and its tools. They do not promote
one consumer's palette, role names, exceptions, or layout rules into defaults for
other projects. Follow the [evidence workflow](README.md) in the project's context.
