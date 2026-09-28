# Design workflow

Portable guidance for a rendered evidence loop. Use it alone or with capture
and geometry tools; it requires no runtime or prescribed document tree. Follow
the consumer's existing document owners and acceptance responsibilities.

## Choose the review tool

Choose by the question being answered, not by the size of the code change.

| Review question | Use |
| --- | --- |
| How does the current UI behave, including focus, hover or animation? | The live browser and the project's behavioral checks. |
| What does a page or component currently look like? | Harness capture on the real page; inspect the original PNG. A single current-state screenshot is enough when no change is being compared. |
| Is a proposed change to existing UI better? “Show me”, “how does it look”, and small border, avatar, spacing or typography changes belong here. | Matching before/after Harness captures and the installed `review` comparison in the conversation when supported. Include a readable detail crop and page context. Do not substitute an after-only screenshot or a live-page link. |
| Why is the rendered alignment, gap, wrapping or size wrong? | Geometry observations beside the captures, where installed. |
| Which colors/tokens or repeated CSS treatments need investigation? | Token inspection or style-usage reports, where installed, followed by rendered evidence for any proposed visual change. |

Use the project's existing reference page to explore real variants and states;
use clearly labeled mockups for directions that do not exist in code yet.
Neither replaces before/after evidence of an implemented change. Follow an
explicit request for a different presentation. If comparison tooling or the
conversation surface is unavailable, state that limitation and show paired
original screenshots; installing every optional module is not required.

## Evidence loop

1. Read existing product intent and accepted design decisions for the affected
   surface. Understand their rationale without assuming the current composition
   must remain unchanged.
2. Inspect the actual production component in its real page. Establish the
   user need, information priority, constraints, and review question with the
   current request. A conversation is sufficient for exploratory context.
3. Use working references when they resolve visual uncertainty. Label retained
   references as exact, directional, or inspiration and name the qualities that
   matter. Reference imagery and rendered implementation evidence have different jobs.
4. Before changing existing UI, retain the affected before state at the selected
   viewport sizes and interaction state. Then implement the smallest coherent
   direction in the actual component. Use real
   content and representative long, empty, and interactive states where relevant.
5. Capture desktop/mobile evidence. Full-page views show composition; bounded
   crops keep the affected details readable. Use a fixture only when state,
   layout context, or scroll runway cannot be exercised adequately on the real page.
6. Open the PNGs. Reject loading, stitching, sticky-chrome, or clipping artifacts
   before treating a capture as trustworthy. Read relevant geometry reports
   beside them when that module is installed. Measurements explain relationships;
   screenshots show visual hierarchy and balance. When token inspection is
   installed, read selected pairs alongside the actual component styles; a ratio
   does not establish where or how the colors are used. Read any named local
   contrast exception and its decision reference. A matching accepted exception
   explains why that finding is retained; do not repeatedly propose the same fix
   without a new reason. Changed conditions reopen review. Keep the measurement
   visible, never use an exception to hide missing evidence, and never invent a
   production approval merely to silence advice.
7. Fix the largest discrepancy and repeat the evidence loop. Behavioral tests
   check accepted invariants; design advice is review input. Human review decides
   whether the result is accepted. No automatic score stands in for that decision.
8. Reconcile the accepted specification and useful references after acceptance.
   Link real implementation and evidence. Record significant rationale in its
   canonical owner; do not proliferate duplicate process or coverage documents.

Fixtures render real components with minimal surrounding structure. Name the
states that materially affect appearance or behavior. Pair state captures with
meaningful semantic assertions; do not fail on harmless pixel-rendering changes.
Keep routine evidence regenerable and separate from durable design references.

Use [design foundations](design-foundations.md) when evolving the project’s
design language. Roles and tokens promoted into its design system stay local
to that project; shared Harness guidance supplies the reasoning method.

When creating or maintaining a browsable style guide or component catalog,
follow [the living design reference guide](design-reference.md). It describes
one project-owned page combining direction, foundations, real examples and page
context. It is optional and does not prescribe a component framework or palette.

When adopting shared tools into an existing test suite, retain the suite's
fixtures, state transitions, and behavioral assertions. Observe and save the
current state through the page-level APIs; the project continues to own browser
lifecycle, readiness, mocks, and product-specific interpretation. Record the
installed toolkit revision alongside the consumer revision when retaining evidence.

## Choose where to capture

Start with the actual application page. Capture the full page for composition
and crop a component or section when its details need a closer look. Keep a way
to inspect the surrounding layout; an isolated sample cannot establish whether
the component works in context.

An existing design reference can be a convenient place to capture selected
variants and states. Use it when it helps answer the review question; capture
does not require that page. Add a dedicated fixture only when the needed state
or layout cannot be exercised adequately on existing pages. Render the real
component in that fixture and retain relevant theme/container context.

Scale the setup to the task. A small landing page may need only page captures
and a few section crops, with no reference page, component catalog, per-component
declarations or exhaustive state inventory. Reuse existing selectors and state
setup; add stable handles only where they make the selected captures reliable.
Choose a crop that includes relevant focus rings, open menus and surrounding
space; a trigger's bounds may exclude a menu rendered elsewhere in the page.

## Review handoff

Place a short, visible review note in chat immediately above a before/after
comparison. Explain enough for the reviewer to understand and challenge the
change, especially when the agent proposed it:

- **Why:** the observed problem, the affected task, and why it matters.
- **Changed:** the concrete difference and where to look in the comparison.
- **Tradeoff:** what becomes less convenient or what the change costs.
- **Recommendation:** whether to keep the change, distinguishing judgment from
  verified behavior and naming meaningful uncertainty.

Adapt the length to the decision. An obvious user-requested change may need only
one sentence; an agent-proposed refinement needs its rationale. Describe small
refinements proportionately. Keep essential reasoning visible; optional hover or
expandable details may hold measurements and evidence, never the only explanation.
Keep the note in ordinary chat text. For changes to existing UI, use the
comparison presentation selected above, even when the change is only one line
of CSS. A small change calls for a small comparison, not an omitted comparison.

Lead with the visible result and at most three prioritized findings. For each,
name the affected task, cite a real screenshot and relevant observation, and
state whether it was fixed, deferred, or needs human judgment. Select one coherent
improvement, retain matching before/after targets, states and viewport sizes,
and explain its tradeoff without presenting measurements as taste scores.

Show readable component crops alongside a way to inspect the component in its
real page context. When the conversation supports interactive comparisons, offer
target selection (for example desktop/mobile), before/after, and detail/context.
Label crops with the original viewport and preserve their scale when comparing.
These are captured states, not a live application. Include the verified running
page URL separately so the reviewer can try the actual controls. The agent owns
commands and evidence interpretation; the reviewer supplies product feedback.

Retain findings and original evidence in the project's existing documentation
structure. The optional review module and conversation presentation remain
technically independent of capture, geometry, and a consumer's test suite; this
does not waive the review handoff when the tools are installed and applicable.
A snapshot comparison does
not update when the running application changes; record that boundary explicitly.

If the edit already happened without a baseline, recover the exact prior state
from a known revision or a narrowly reversible task-owned edit, preserve other
working changes, and label the baseline as reconstructed. Do not invent a before
image or present two identical captures as evidence of a visual change.
