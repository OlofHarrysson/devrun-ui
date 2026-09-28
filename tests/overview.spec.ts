import { test, expect, type Page } from "@playwright/test";
import type { ProjectState } from "../src/types/ui";

const NOW = Date.parse("2026-09-28T14:00:00Z");
function projects(): ProjectState[] {
  const service = (name: string, hours: number, running = true) => ({ name, cmd: `npm run ${name}`, running, status: running ? "ready" : "stopped", startedAt: new Date(NOW - hours * 3600000).toISOString(), runId: running ? `run-${name}` : undefined });
  return [
    { id: "recent", name: "Recent project", root: "/projects/recent", services: [service("web", 1), service("worker", 40)] },
    { id: "older", name: "Older project", root: "/projects/older", services: [service("web", 12)] },
    { id: "stopped", name: "Stopped project", root: "/projects/stopped", services: [service("web", 2, false)] },
    { id: "unknown", name: "Unknown project", root: "/projects/unknown", services: [{ name: "worker", cmd: "worker", running: true, status: "ready" }] },
    { id: "history", name: "History project", root: "/projects/history", services: [{ name: "web", cmd: "web", running: false }] },
  ];
}
async function fixture(page: Page, initial = projects()) {
  let current = initial;
  let stateFails = false, actionFails = false, deferred = false;
  const actions: Array<{ action: string; projectId: string; serviceName: string }> = [];
  const reads: string[] = [];
  let sockets = 0;
  page.on("websocket", (socket) => { if (new URL(socket.url()).pathname === "/ws") sockets++; });
  await page.clock.setFixedTime(NOW);
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (req.method() === "GET") reads.push(url.pathname);
    if (url.pathname === "/api/state") return route.fulfill(stateFails ? { status: 503, json: { error: "Offline" } } : { json: { projects: current } });
    if (url.pathname === "/api/history") return route.fulfill({ json: { events: url.searchParams.get("projectId") === "history" ? [{ seq: 1, type: "start", ts: new Date(NOW - 3 * 3600000).toISOString() }] : [] } });
    if (url.pathname.startsWith("/api/process/")) {
      const action = url.pathname.split("/").pop()!; const payload = req.postDataJSON(); actions.push({ action, ...payload });
      if (actionFails) return route.fulfill({ status: 500, json: { error: "Stop refused" } });
      if (!deferred) {
        const service = current.find((p) => p.id === payload.projectId)!.services.find((s) => s.name === payload.serviceName)!;
        Object.assign(service, { running: action === "start", status: action === "start" ? "starting" : "stopped", startedAt: action === "start" ? new Date(NOW).toISOString() : service.startedAt });
      }
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/api/logs") return route.fulfill({ json: { output: "Saved output\r\n" } });
    return route.fulfill({ status: 500, json: { error: "Unexpected endpoint" } });
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => { socket.send(JSON.stringify({ type: "meta", runId: "run-worker" })); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^All \(/ })).toBeVisible();
  return { actions, reads, sockets: () => sockets, failState: (value: boolean) => { stateFails = value; }, failAction: () => { actionFails = true; }, defer: () => { deferred = true; }, update: (next: ProjectState[]) => { current = next; } };
}

test("filters and sorts by actual starts, including stopped history; overview opens no terminal", async ({ page }) => {
  const mock = await fixture(page);
  await expect(page.locator(".overview-project h2")).toHaveText(["Recent project", "Older project", "Unknown project"]);
  await expect(page.getByText("Running for 40h", { exact: true })).toBeVisible();
  await page.getByLabel("Sort projects").selectOption("longest");
  // The old worker makes this project older than the other project's web service.
  await expect(page.locator(".overview-project h2").first()).toHaveText("Recent project");
  await page.getByRole("button", { name: /^All \(/ }).click();
  await page.getByLabel("Sort projects").selectOption("recent");
  await expect(page.locator(".overview-project h2")).toHaveText(["Recent project", "Stopped project", "History project", "Older project", "Unknown project"]);
  await expect(page.getByRole("region", { name: "History project", exact: true })).toContainText("Last started 3h ago");
  expect(mock.reads).not.toContain("/api/logs"); expect(mock.sockets()).toBe(0);
  await page.getByLabel("Search projects", { exact: true }).fill("/projects/older");
  await expect(page.locator(".overview-project")).toHaveCount(1);
});

test("stop removes only the intended running service and permits a later start", async ({ page }) => {
  const mock = await fixture(page);
  await page.getByRole("button", { name: "Stop Older project web", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Older project", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Older project / web stopped. Configuration kept");
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByRole("region", { name: "Recent project", exact: true })).toContainText("Running for 40h");
  await page.getByRole("button", { name: /^All \(/ }).click();
  await page.getByRole("button", { name: "Start Older project web", exact: true }).click();
  await expect(page.getByRole("region", { name: "Older project", exact: true })).toContainText("Starting");
  expect(mock.actions).toEqual([{ action: "stop", projectId: "older", serviceName: "web" }, { action: "start", projectId: "older", serviceName: "web" }]);
});

test("pending actions wait for state confirmation and prevent duplicate requests", async ({ page }) => {
  const mock = await fixture(page); mock.defer();
  const stop = page.getByRole("button", { name: "Stop Older project web", exact: true });
  await stop.click(); await expect(stop).toBeDisabled(); await expect(stop).toHaveText("Stopping…");
  await expect(page.getByRole("region", { name: "Older project", exact: true })).toBeVisible();
  expect(mock.actions).toHaveLength(1);
  const next = projects(); next[1].services[0].running = false; mock.update(next);
  await expect(page.getByRole("region", { name: "Older project", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("stopped");
});

test("failed actions stay visible and stale state disables controls until recovery", async ({ page }) => {
  const mock = await fixture(page); mock.failAction();
  await page.getByRole("button", { name: "Stop Older project web", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Older project / web: Stop refused");
  await expect(page.getByRole("button", { name: "Stop Older project web", exact: true })).toBeEnabled();
  mock.failState(true);
  await expect(page.getByRole("alert").filter({ hasText: "Cannot refresh" })).toContainText("Showing state");
  await expect(page.getByRole("button", { name: "Stop Older project web", exact: true })).toBeDisabled();
  mock.failState(false); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop Older project web", exact: true })).toBeEnabled();
});

test("agent changes appear and service detail links select the right service", async ({ page }) => {
  const mock = await fixture(page);
  const next = projects(); next[2].services[0].running = true; next[2].services[0].status = "ready"; mock.update(next);
  await expect(page.getByRole("region", { name: "Stopped project", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Recent project", exact: true }).getByRole("link", { name: "worker", exact: true }).click();
  await expect(page).toHaveURL(/\/project\?project=recent&service=worker/);
  await expect(page.locator(".service-command")).toHaveText("npm run worker");
  await page.locator(".project-item", { hasText: "Older project" }).click();
  await expect(page).toHaveURL(/project=older&service=web/);
  await page.reload();
  await expect(page.locator("#project-header h2")).toHaveText("Older project");
  await page.getByRole("link", { name: "← All projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
});

for (const width of [1440, 1024, 390, 320]) {
  test(`overview fits ${width}px with long names and paths`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const data = projects(); data[0].name = "Very-long-project-name-".repeat(8); data[0].root = "/projects/" + "long-path/".repeat(20); data[0].services[0].name = "very-long-service-name-".repeat(6);
    await fixture(page, data);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await expect(page.getByRole("button", { name: `Stop ${data[0].name} ${data[0].services[0].name}`, exact: true })).toBeVisible();
  });
}

test("empty and fully stopped registries provide a route back to manual starts", async ({ page }) => {
  const mock = await fixture(page, []);
  await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
  mock.update([projects()[2]]);
  await expect(page.getByText("Nothing running", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all projects", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start Stopped project web", exact: true })).toBeEnabled();
});
