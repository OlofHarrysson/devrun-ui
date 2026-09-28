# Review comparisons

Build an interactive conversation comparison from existing Harness capture
indexes or explicitly selected page-level evidence records. One renderer supplies target/view selection, before/after and side-by-side
views, original PNGs, and project-owned live links. It collects no new evidence,
starts no service, and needs only Node.js. Keep the visible rationale in chat
above the comparison using the [review handoff](../workflow/README.md#review-handoff).

## Inspecting details

Pinch over either screenshot on a desktop trackpad to enlarge both captures at
the same scale, anchored at the pointer. Two-finger scrolling pans the enlarged
image; at its edge, scrolling continues through the conversation. Pinch inward
to return to the fitted view. Changing target, view or comparison mode resets
the magnification. Controls remain their normal size and no zoom buttons are
added. Zoom is temporary presentation state, not saved review evidence.

The renderer handles Ctrl-wheel pinch events and WebKit gesture events when the
host delivers them to the embedded page. Automated event tests do not establish
physical-trackpad delivery in Codex. Mobile touch behavior is unvalidated;
the selected target is a desktop trackpad. Raster captures can become soft above
their original resolution.

## Run

From the source checkout:

```sh
node modules/review/build.mjs examples/test-site/form-review.json artifacts/form-review.html
node modules/review/build.mjs examples/test-site/button-review.json artifacts/button-review.html
```

These two examples use identical shared code. Output is an HTML fragment for the
conversation visualization capability, not a standalone website. The agent reads
that capability's instructions, builds to its designated durable directory,
previews the fragment, and presents it in chat. Optional host state remembers
selections by review ID. Without the host API, the controls still work; this
fragment expects the host's styles. A host-specific preview wrapper is development
tooling, not a Harness dependency.

The optional `review` module can be installed with the source repository's
installer. Select `--modules=review` for a Node-only copy, or combine it with
browser modules. From a consumer, run the installed entry point:

```sh
node tools/design-review/modules/review/build.mjs review.json artifacts/review.html
```

Keep `review.json` and evidence outside the managed installation. The installed
copy does not import the source checkout. Updates use the same revision tracking,
preview, conflict checks and validation as other modules. See the source
[installation guide](../../docs/installation.md#install-the-comparison-tool).
Existing consumers are not enrolled automatically; no Looper review integration
has been performed. The default module selection is unchanged.

## Project-owned configuration (schema 1)

Paths to indexes or direct records resolve relative to the configuration file. Evidence paths in
an index resolve relative to that index, following the existing runner contract.
Supply a unique review ID, ordered targets and views, and an explicit capture
key for each version of every target/view pair. The first target and view are
the defaults. A single target or view hides its redundant dropdown.

```json
{
  "schemaVersion": 1,
  "id": "navigation-review",
  "before": "evidence/before/index.json",
  "after": "evidence/after/index.json",
  "targets": [{ "id": "phone", "label": "Mobile" }],
  "views": [{
    "id": "detail",
    "label": "Navigation",
    "liveUrl": "http://localhost:3030/#navigation",
    "captures": {
      "phone": {
        "before": "navigation/default/mobile/capture",
        "after": "navigation/default/mobile/capture"
      }
    }
  }]
}
```

IDs start with a lowercase letter, contain lowercase letters/digits/hyphens, and
are at most 80 characters. Target/view IDs must be unique in their lists. Labels
are plain text and live links must be HTTP(S) without embedded credentials.
Omit `liveUrl` (or set null) for a desktop app without a web address. The
comparison then hides its live-page link; supplied links still require safe HTTP(S).

Project configuration owns labels, capture selection and verified live URLs;
shared code owns rendering and validation. No form, button, route, port or
viewport names are hardcoded in the shared implementation.

The library also exports `buildReview(config, { baseDir })` returning the
fragment and `writeReview(configFile, output)` writing it after validation.
No existing capture, geometry, token or adapter API changed. This presentation
configuration is separate from capture configuration and evidence schema 1.

## Page-level test evidence

Each `before`/`after` input can instead be a records map. Keep the same target/view
controls and capture keys; select JSON files directly without creating an index:

```json
{
  "before": { "records": { "navigation/default/mobile": "before/navigation.json" } },
  "after": { "records": { "navigation/default/mobile": "after/navigation.json" } }
}
```

This is the input portion of a schema-1 review configuration, not a complete
configuration. The existing `views[].captures` references those map keys. One side
may use an index while the other uses direct records.

The current `writeEvidence(page, options)` adds `artifacts.png`, a filename relative
to its JSON record. Keep the JSON and PNG together when moving retained evidence.
Its legacy `png` field is unchanged. Direct inputs accept complete capture,
geometry or token records with a screenshot; they preserve the actual report kind,
source, toolkit revision and fixture details. They never relabel a geometry report
as a capture or rewrite the evidence. Older page-writer records without
`artifacts.png` must be recaptured with the updated writer; paths are never guessed.

The consumer owns test outcomes. Publish the review configuration only after the
selected assertions and evidence pass, then run the shared builder. A complete
record alone does not prove that its enclosing test suite passed. This tool does
not search output folders, choose retries, merge worker results or infer baselines.
The [example suite](../../examples/test-site/page-review.test.mjs) demonstrates
that sequence with its [local adapter](../../examples/test-site/page-review.mjs).

## Evidence and limits

- Inputs require schema-1 PNG evidence: indexed runner captures or direct
  page-writer records with `artifacts.png`. JPEGs, image conversion and native
  capture adapters are not implemented here.
- Every selected record must be complete; index entries must also agree on run and PNG,
  and have no missing observations, execution issues or behavioral failures.
  Incomplete evidence fails explicitly; it is never replaced with an old success.
- Each pair must have matching viewport dimensions and device scale. Dimensions
  in the caption come from the records. Different crop heights are retained;
  side-by-side images use a common display scale rather than stretching each
  crop independently. The agent still verifies that the selected states and
  framing make a meaningful comparison.
- Original PNGs are embedded without editing. Run IDs, capture times and source
  revisions remain in embedded metadata and original records. The complete
  fragment must stay below 1 MB; select fewer captures if it exceeds the limit.
- No network requests occur in the fragment. Live links require a separately
  running application and are never started or verified by this builder.
- Collection completeness does not establish design quality or human approval.
  Overflow may itself be the subject of the comparison. Captured snapshots do
  not follow later application changes.
- Validation errors leave any existing output unchanged and return a nonzero
  CLI exit status. An old output after a failed command is not a fresh review.

[Tests](../../tests/review.test.mjs) exercise indexed and direct-record reviews, evidence/viewport
rejection, output preservation, plain-text label escaping, actual image decoding,
selection, scale and state restoration. The [button checkpoint](../../docs/evidence/button-review/README.md)
records inspected desktop/mobile evidence and standalone preview validation.
The [page-level checkpoint](../../docs/evidence/page-review/README.md) records
the test-suite connection, relocation checks and installed direct-record build.
