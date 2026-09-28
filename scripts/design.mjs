import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { measurePage } from "../tools/design-harness/modules/geometry/observe.mjs";
import { writeEvidence } from "../tools/design-harness/modules/core/evidence.mjs";
import { buildReview } from "../tools/design-harness/modules/review/build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, "artifacts/design");
const baseURL = process.env.DESIGN_BASE_URL || "http://localhost:4317";
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const log = "$ npm run dev\r\nReady on http://localhost:3000\r\nGET / 200 in 38ms\r\n[process exited 0]\r\n";
const project = {
  id: "design-project", name: "Made by Olof", root: "/projects/madebyolof", defaultService: "web",
  services: [{ name: "web", cmd: "npm run dev", port: 3000, running: false, status: "stopped", lastRunId: "fixture-run", logFilePath: "/projects/devrun/.devrun/runtime/logs/design-project/web/fixture-run.log" },
    { name: "worker", cmd: "npm run worker", running: false, status: "stopped" }],
};
const projects = [project, ...Array.from({ length: 11 }, (_, index) => ({ ...project, id: `project-${index}`, name: `Project ${index + 2}`, root: `/projects/project-${index + 2}` }))];
const events = [{ seq: 2, type: "exit", ts: "2026-09-28T09:31:00Z", runId: "fixture-run", data: { exitCode: 0 } }, { seq: 1, type: "start", ts: "2026-09-28T09:30:00Z", runId: "fixture-run", data: { cmd: "npm run dev" } }];
function checkedName(name) {
  assert.match(name || "", /^[a-z][a-z0-9-]{0,59}$/, "Use a lowercase snapshot name, up to 60 characters.");
  return name;
}
const readJSON = async (file) => JSON.parse(await readFile(file, "utf8"));

async function capture(name) {
  const directory = path.join(artifacts, checkedName(name));
  await mkdir(artifacts, { recursive: true });
  await mkdir(directory); // Baselines are immutable; a failed run never publishes a passing manifest.
  const browser = await chromium.launch({ headless: true });
  const records = {};
  const findings = [];
  try {
    for (const [viewport, size] of Object.entries(viewports)) {
      for (const state of ["stopped", "empty", "configuration-error", "reference"]) {
        const context = await browser.newContext({ viewport: size, reducedMotion: "reduce", timezoneId: "UTC" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("dialog", async (dialog) => { errors.push(`Unexpected dialog: ${dialog.message()}`); await dialog.dismiss(); });
        // Never let evidence collection control the shared process manager.
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          assert.equal(request.method(), "GET", `Unexpected mutation: ${pathname}`);
          let body;
          if (pathname === "/api/state") body = { projects: state === "empty" ? [] : state === "configuration-error" ? [{ ...project, services: [], configError: "Command is missing for web.", configPath: "/projects/devrun/project-configs.json" }] : projects };
          else if (pathname === "/api/history") body = { events, latestSeq: 2, retention: 100 };
          else if (pathname === "/api/logs") body = { output: log, runId: "fixture-run" };
          else throw new Error(`Unmocked endpoint: ${pathname}`);
          await route.fulfill({ json: body });
        });
        await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => socket.close());
        const logsReady = state === "stopped" ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/logs") : null;
        await page.goto(`${baseURL}${state === "reference" ? "/design" : "/"}`);
        if (state === "reference") {
          await page.getByRole("heading", { name: "A quieter place to keep things running." }).waitFor();
          await page.locator("#cmd-start-btn").focus();
          assert.equal(await page.locator("#cmd-start-btn").evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
          await page.keyboard.press("Enter");
          await page.getByRole("status").filter({ hasText: "Demo: web ready" }).waitFor();
          assert.equal(await page.locator("#command-bar .badge-success").innerText(), "ready");
          await page.locator("#cmd-stop-btn").click();
          await page.getByRole("status").filter({ hasText: "Demo: web stopped" }).waitFor();
          await page.locator("#cmd-restart-btn").click();
          await page.getByRole("status").filter({ hasText: "Demo: web ready" }).waitFor();
          await page.getByRole("button", { name: "Reset demo" }).click();
        } else if (state === "empty") await page.getByText("No projects yet.", { exact: true }).waitFor();
        else if (state === "configuration-error") await page.getByText("Project not configured", { exact: true }).waitFor();
        else {
          await page.locator("#cmd-start-btn").waitFor();
          await page.locator(".xterm-screen").waitFor();
          await page.waitForFunction(() => document.querySelector(".terminal-tab-status")?.textContent === "stopped (logs)");
        }
        if (logsReady) {
          await logsReady;
          await page.waitForTimeout(150); // xterm batches canvas writes after the log response.
        }
        await page.evaluate(() => document.fonts.ready);
        const target = state === "reference" ? "reference" : "workspace";
        const scope = state === "reference" ? {
          id: target, root: "main", regions: [{ id: "intro", selector: ".reference-intro" }, { id: "components", selector: "#components" }],
        } : {
          id: target, root: "body", regions: [{ id: "projects", selector: "#projects" }, { id: "header", selector: "#project-header" }, { id: "actions", selector: "#command-bar" }, { id: "terminal", selector: "#terminal-stack" }, { id: "history", selector: "#history-panel" }],
        };
        async function save(captureTarget, crop) {
          const basePath = path.join(directory, `${captureTarget}-${state}-${viewport}`);
          const observation = await measurePage(page, scope);
          const record = await writeEvidence(page, { basePath, observation, crop,
            identity: { target: captureTarget, state, viewport }, sourceRoot: root,
            details: { data: "deterministic fixtures; no live process controls", baseURL },
            issues: errors.map((message) => ({ type: "browser", message })),
          });
          assert.equal(record.status, "complete", JSON.stringify(record));
          assert.deepEqual(errors, []);
          records[`${captureTarget}/${state}/${viewport}`] = path.relative(directory, `${basePath}.json`);
          findings.push({ target: captureTarget, state, viewport, horizontalOverflow: observation.diagnostics.horizontalOverflow, page: observation.diagnostics.page });
          // Existing workspace overflow is audit evidence. New reference must fit.
          if (state === "reference") assert.equal(observation.diagnostics.horizontalOverflow, 0, "Reference must fit viewport");
        }
        await save(target);
        if (state === "reference") {
          await page.locator("#components").scrollIntoViewIfNeeded();
          await save("controls", "#components");
          await page.getByLabel("Component theme").selectOption("corporate");
          await save("controls-current", "#components");
        }
        await context.close();
      }
    }
    await writeFile(path.join(directory, "snapshot.json"), JSON.stringify({ schemaVersion: 1, status: "passed", baseURL, records, findings }, null, 2) + "\n");
    console.log(`Saved ${Object.keys(records).length} records: ${directory}/snapshot.json`);
    console.log(JSON.stringify(findings));
  } finally { await browser.close(); }
}

async function review(before, after, target = "workspace", state = "stopped") {
  const inputs = {};
  for (const [side, name] of [["before", before], ["after", after]]) {
    const directory = path.join(artifacts, checkedName(name));
    const manifest = await readJSON(path.join(directory, "snapshot.json"));
    assert.equal(manifest.status, "passed");
    inputs[side] = { records: Object.fromEntries(Object.entries(manifest.records).map(([key, file]) => [key, path.join(directory, file)])) };
  }
  const html = await buildReview({ schemaVersion: 1, id: `devrun-${target}-${state}`, ...inputs,
    targets: Object.keys(viewports).map((id) => ({ id, label: id })),
    views: [{ id: target, label: before === after ? "Installation check — same snapshot" : `${before} → ${after}`,
      liveUrl: `${baseURL}${target === "workspace" ? "/" : "/design"}`,
      captures: Object.fromEntries(Object.keys(viewports).map((id) => [id, { before: `${target}/${state}/${id}`, after: `${target}/${state}/${id}` }])) }],
  });
  const file = path.join(artifacts, `${checkedName(before)}-${checkedName(after)}-${checkedName(target)}-${checkedName(state)}.html`);
  await writeFile(file, html);
  console.log(`Review fragment (conversation viewer): ${file}`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "capture" && args.length === 1) await capture(args[0]);
  else if (command === "review" && args.length >= 2 && args.length <= 4) await review(...args);
  else if (command === "validate" && args.length === 0) {
    const name = `validation-${Date.now()}`;
    await capture(name);
    await review(name, name);
  } else throw new Error("Usage: design:capture -- <name> | design:review -- <before> <after> [target] [state] | design:validate");
} catch (error) { console.error(error); process.exitCode = 1; }
