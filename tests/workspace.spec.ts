import { expect, test, type Page } from "@playwright/test";
import type { ProjectState } from "../src/types/ui";

async function mockWorkspace(page: Page, status = "stopped", count = 33) {
  const running = ["ready", "starting"].includes(status);
  const project: ProjectState = {
    id: "fixture", name: "Made by Olof", root: "/projects/madebyolof",
    services: [
      { name: "web", cmd: "npm run dev", running, status, ready: status === "ready", port: 3000,
        effectiveUrl: "http://localhost:3000", runId: running ? "run-web" : undefined,
        lastRunId: "previous-web", logFilePath: `/projects/${"long-folder/".repeat(20)}run.log` },
      { name: "worker", cmd: "npm run worker", running: false, status: "stopped", lastRunId: "worker-run" },
    ], defaultService: "web",
  };
  let projects = Array.from({ length: count }, (_, index) => index === 0 ? project : {
    ...project, id: `fixture-${index}`, name: `Project ${index + 1} with a descriptive name`, root: `/projects/${"long-project-name/".repeat(10)}${index}`,
  });
  const actions: Array<{ action: string; projectId: string; serviceName: string }> = [];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== "GET") mutations.push(url.pathname);
    if (url.pathname === "/api/state") return route.fulfill({ json: { projects } });
    if (url.pathname === "/api/history") return route.fulfill({ json: { events: [{ seq: 1, type: "start", ts: "2026-09-28T10:00:00Z", data: { cmd: "npm run dev" } }], latestSeq: 1, retention: 100 } });
    if (url.pathname === "/api/logs") return route.fulfill({ json: { output: `Saved ${url.searchParams.get("serviceName")} output\r\n`, runId: "previous-web" } });
    if (url.pathname.startsWith("/api/process/")) {
      const action = url.pathname.split("/").pop()!;
      const payload = req.postDataJSON();
      actions.push({ action, ...payload });
      const service = projects.find((entry) => entry.id === payload.projectId)?.services.find((entry) => entry.name === payload.serviceName);
      if (service) Object.assign(service, { running: action !== "stop", status: action === "stop" ? "stopped" : "ready", ready: action !== "stop", runId: action === "stop" ? undefined : "run-web" });
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/api/logs/open") return route.fulfill({ json: { ok: true } });
    if (req.method() === "DELETE") {
      projects = projects.filter((entry) => entry.id !== url.pathname.split("/").pop());
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected fixture request: ${url.pathname}` } });
  });
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    socket.send(JSON.stringify({ type: "meta", runId: "run-web" }));
    socket.send(JSON.stringify({ type: "output", data: "Service ready\r\n" }));
  });
  await page.goto("/project");
  if (count) await expect(page.locator(".service-status")).toHaveText(status);
  return { actions, mutations };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`workspace fits ${viewport.width}px with 33 projects and long paths`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockWorkspace(page);
    await expect(page.locator(".xterm-screen")).toBeVisible();
    if (viewport.width >= 768) {
      expect(await page.locator("#projects").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await page.getByLabel("Search projects", { exact: true }).fill("Project 33");
      await expect(page.locator(".project-item")).toHaveCount(1);
      await page.locator(".project-item").click();
      await expect(page.locator("#project-header h2")).toHaveText("Project 33 with a descriptive name");
    } else {
      await expect(page.locator("#projects")).toBeHidden();
      await page.getByLabel("Choose project", { exact: true }).selectOption("fixture-32");
      await expect(page.locator("#project-header h2")).toHaveText("Project 33 with a descriptive name");
    }
    await page.locator(".service-details summary").click();
    await expect(page.locator("#cmd-open-log-btn")).toBeVisible();
    const dims = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }));
    expect(dims.width).toBe(dims.viewportWidth);
    expect(dims.height).toBe(dims.viewportHeight);
    expect((await page.locator("#terminal-stack").boundingBox())!.height).toBeGreaterThan(150);
  });
}

test("actions follow lifecycle, preserve API targets, and expose log details", async ({ page }) => {
  const { actions, mutations } = await mockWorkspace(page);
  await expect(page.locator("#cmd-stop-btn")).toHaveCount(0);
  await expect(page.locator("#cmd-restart-btn")).toHaveCount(0);
  await page.locator("#cmd-start-btn").click();
  await expect(page.locator("#cmd-open-app-link")).toHaveAttribute("href", "http://localhost:3000");
  await expect(page.locator("#cmd-start-btn")).toHaveCount(0);
  await page.locator("#cmd-restart-btn").click();
  await expect.poll(() => actions.length).toBe(2);
  await page.locator("#cmd-stop-btn").click();
  await expect(page.locator("#cmd-start-btn")).toBeVisible();
  expect(actions).toEqual(["start", "restart", "stop"].map((action) => ({ action, projectId: "fixture", serviceName: "web" })));
  await page.locator(".service-details summary").click();
  await page.locator("#cmd-open-log-btn").click();
  await expect.poll(() => mutations).toContain("/api/logs/open");
});

test("history refits the terminal and service switching retains one terminal per service", async ({ page }) => {
  await mockWorkspace(page);
  const screen = page.locator(".terminal-view:not(.hidden) .xterm-screen");
  await expect(screen).toBeVisible();
  const width = (await screen.boundingBox())!.width;
  await page.locator("#history-toggle").click();
  await expect(page.locator("#history-panel")).toBeVisible();
  await expect.poll(async () => (await screen.boundingBox())!.width).toBeLessThan(width - 200);
  await expect(page.locator("#history-panel")).toContainText("npm run dev");
  await page.getByRole("button", { name: "Close history", exact: true }).click();
  await expect.poll(async () => (await screen.boundingBox())!.width).toBeGreaterThan(width - 20);
  await page.locator(".terminal-tab", { hasText: "worker" }).click();
  await expect(page.locator(".service-command")).toHaveText("npm run worker");
  await page.locator(".terminal-tab", { hasText: "web" }).click();
  await expect(page.locator(".service-command")).toHaveText("npm run dev");
  await expect(page.locator(".terminal-view")).toHaveCount(2);
  await expect(page.locator(".terminal-view:not(.hidden)")).toHaveCount(1);
});

test("starting keeps stop available, while failed service offers start and visible error", async ({ page }) => {
  await mockWorkspace(page, "starting");
  await expect(page.locator("#cmd-stop-btn")).toBeEnabled();
  await expect(page.locator("#cmd-open-app-link")).toHaveCount(0);
  await expect(page.locator("#cmd-start-btn")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await mockWorkspace(page, "error");
  await expect(page.locator("#command-bar").getByRole("alert")).toContainText("Service failed");
  await expect(page.locator("#cmd-start-btn")).toBeEnabled();
});

test("project removal is secondary and keyboard accessible", async ({ page }) => {
  const { mutations } = await mockWorkspace(page);
  await expect(page.getByRole("button", { name: "Configure", exact: true })).toHaveCount(0);
  const menu = page.getByLabel("Project actions", { exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove project", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(page.getByRole("button", { name: "Remove project", exact: true })).toBeHidden();
  await menu.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove project", exact: true }).click();
  await expect.poll(() => mutations).toContain("/api/projects/fixture");
  await expect(page.locator("#project-header h2")).not.toHaveText("Made by Olof");
});

test("empty workspace explains agent setup", async ({ page }) => {
  await mockWorkspace(page, "stopped", 0);
  await expect(page.getByText("Bring your projects here.", { exact: true })).toBeVisible();
  await expect(page.locator("#command-bar")).toContainText("Ask your agent");
  await expect(page.locator("#cmd-start-btn")).toHaveCount(0);
});


test("mobile history replaces output and returns keyboard focus when closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  await page.locator("#history-toggle").click();
  await expect(page.locator("#terminal-stack")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close history", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#history-toggle")).toBeFocused();
  await expect(page.locator("#terminal-stack")).toBeVisible();
});
