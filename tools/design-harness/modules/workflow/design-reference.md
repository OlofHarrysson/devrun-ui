# Build a project's living design reference

Use this guide when asked to create or improve a browsable style guide, design
reference, or component catalog. The outcome is a project-owned page at one
known URL: visual direction, foundations, real examples and page context in one
place. It helps a human judge the design and an agent find what already exists.
It is optional; installing Design Harness does not require building this page.

Create a reference when there is a need to browse and understand the design.
For screenshot work alone, start with existing application pages; a small
landing page can be reviewed without a separate reference. If a reference already
exists, its real examples can also serve as capture locations. Follow the
[capture-location guidance](README.md#choose-where-to-capture) and keep real page
context available when evaluating layout. No catalog-to-capture registry or
complete correspondence between displayed examples and capture targets is required.

## Start with the project

Read its existing design intent, accepted decisions, component/style sources and
internal tools. Open its current reference if one exists and improve that page.
Keep its route, framework and conventions unless the task requires a change.
A single page importing components is enough. Split sections into ordinary local
files when helpful; no story files, component manifest, automatic discovery,
new framework or shared catalog renderer are required. If an existing component
workshop serves the need, connect to it instead of creating a competing catalog.

Choose a useful first slice from the actual product: a primary action, an input
or dropdown, a content surface, and a page where those pieces matter. That is an
example selection, not a mandatory inventory. Do not build missing product
components just to fill a checklist. Preserve the agreed scope and design language;
creating a reference is not permission to redesign the application.

## Curate a coherent page

Adapt the order and labels to the project. These are content responsibilities,
not a prescribed layout or a universal design system:

| Content | What a human should understand |
| --- | --- |
| Direction and references | The intended mood, hierarchy and character; which visual qualities to follow |
| Foundations | The actual palette, typography and relevant shapes/spacing, with their jobs explained |
| Live examples and states | What important components look like and how they behave |
| Compositions and pages | How the pieces work together at real desktop/mobile sizes |

Put a concise direction and a useful section index near the top. Prefer a few
specific principles to generic adjectives. Label external or generated references
as exact, directional or inspiration and explain what each informs. Identify
current implementation captures separately from aspirational references. If no
reference or accepted direction exists, say so; do not invent one or claim a
working example has founder approval. Keep exploratory examples distinguishable
from accepted decisions, with a link to the project's existing decision owner.

Display colors with their roles, not just swatches. Reuse the project's CSS/token
source for both the rendered sample and any numeric labels, rather than keeping
a second palette in the reference. Describe a font's job using actual text; do
not impose the Harness example's typeface, colors, spacing, names or exceptions.
The [design reasoning method](design-foundations.md) can help identify roles.

## Render the real implementation

Import the same components, styles, fonts and behavior used by the application.
Use ordinary component inputs and realistic, deterministic sample content. Share
a small existing rendering helper if the project has no component framework;
avoid a second hand-written version that merely resembles the production UI.
Keep real theme/container context when it affects the component's appearance.

Show the states that materially change behavior or appearance: for example a
button's disabled/focused states, a dropdown's open/selected states, and a form's
error/success states. Label how to reach them. Use actual props or real interaction,
not a CSS imitation of focus, an overlaid disabled label, or a timer that makes
captures unreliable. Long, empty and loading examples belong where they expose a
real product concern. Disclose unsupported or unrepresented states rather than
implying exhaustive coverage. Provide a predictable reset when state persists.

Exercise effects locally: prevent reference-page forms from sending real messages,
purchases or production writes. Use the project's existing safe fixture/mocking
approach and label demo outcomes. Do not embed real private customer data.

Small controls should be live when practical. For compositions needing a full
viewport, show original desktop/mobile captures with viewport, capture date or
revision, and a link to the real page/state. An old screenshot is a snapshot,
not a current interactive component. Explain the refresh command or link to its
owner; keep missing or stale evidence visible. Do not distort desktop layouts
into thumbnail containers or present reconstructed markup as the real page.

## Keep ownership and access clear

The consumer owns the page, content, fixtures, assets, state setup, selected
examples, design decisions and route visibility. Keep all of these outside the
managed Harness installation. The shared workflow supplies this method; optional
capture/geometry/tokens/review modules supply evidence mechanics. The page must
not depend on those modules merely to render its ordinary examples.

Use the consumer's existing internal-route policy. Verify how the page is exposed
in development, preview and production; a route named `/internal` or a `noindex`
tag is not access control. Keep a public reference public when that is the
project's intent. Do not add deployment/auth infrastructure just for the catalog.

Link the page and its implementation from the project's existing AGENTS, README,
design or testing owner, where a future agent will find them. Keep a compact local
integration note there containing the following facts (not a required new file):

- The reference URL and page source; how the agent starts the local service.
- The real component/style owners and any safe fixtures or mocks.
- The represented states, how to exercise/reset them, and meaningful omissions.
- The existing design-intent/decision owner and the status of the direction.
- Visibility policy and the validation/capture refresh command, if available.
- A link to this installed guide; existing installation notes link back to the
  Design Harness source and identify the installed revision.

## Validate and maintain it

The agent runs commands and reviews evidence; the human judges usefulness and
visual direction. Open the page on desktop and mobile, exercise representative
keyboard/pointer states, follow context links, and inspect actual output for
clipping, broken assets and confusing hierarchy. Use the existing tests and
available Harness modules. Workflow-only consumers can validate through their
normal browser/test setup; do not install extra modules to satisfy this guide.
Read measurements alongside screenshots when collected, without equating a test
pass or a ratio with visual acceptance. Follow the [review workflow](README.md).

Before handoff, establish that a real component/style change reaches its live
reference example through the shared source. Confirm that numeric token labels
agree with that source, and that frozen captures are clearly labeled. Use a
small reversible probe if this relationship is unclear. Report what was checked,
which states remain untested, and what needs human judgment.

When changing a represented component, update affected fixtures, explanations and
snapshots in the same task. Accepted intent stays in its canonical local owner;
the reference explains and links to it rather than creating a second rulebook.
A Harness update can revise this guidance but must preserve the consumer page.
Finish with the verified URL, a short explanation of what to inspect, validation
and limits. A new reference is ready for review when the human can understand the
direction, try representative pieces, and reach real page context without having
to run commands or decode a test report.
