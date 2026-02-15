import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "@playwright/test";

type ProjectServiceState = {
  name: string;
  running: boolean;
  runId?: string;
  lastRunId?: string;
};

type ProjectState = {
  id: string;
  name: string;
  services: ProjectServiceState[];
};

type StateResponse = {
  projects: ProjectState[];
};

type HistoryEvent = {
  seq: number;
  type: string;
  runId?: string;
};

type HistoryResponse = {
  events: HistoryEvent[];
  latestSeq: number;
  nextAfterSeq: number;
  retention: number;
};

const PROJECT_NAME = `devrun-e2e-ui-${Date.now()}`;
const SERVICE_NAME = "echo";
const BASE_URL = "http://localhost:4421";

let projectRoot = "";
let projectId = "";

async function api(pathname: string, init?: RequestInit) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${pathname}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function getServiceState() {
  const state = (await api("/api/state")) as StateResponse;
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(`Missing project ${projectId} in state`);
  }

  const service = project.services.find((entry) => entry.name === SERVICE_NAME);
  if (!service) {
    throw new Error(`Missing service ${SERVICE_NAME} in project state`);
  }

  return service;
}

async function getHistory(afterSeq = 0, limit = 100) {
  return (await api(
    `/api/history?projectId=${encodeURIComponent(projectId)}&serviceName=${encodeURIComponent(SERVICE_NAME)}&afterSeq=${afterSeq}&limit=${limit}`,
  )) as HistoryResponse;
}

test.beforeAll(async () => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devrun-ui-e2e-"));

  const created = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      root: projectRoot,
      name: PROJECT_NAME,
    }),
  });
  projectId = created.project.id;

  await api("/api/project-config", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      name: PROJECT_NAME,
      services: [
        {
          name: SERVICE_NAME,
          cmd: `node -e "console.log('ready'); let i=0; setInterval(()=>console.log('tick:'+ ++i), 200);"`,
        },
      ],
    }),
  });
});

test.afterAll(async () => {
  if (projectId) {
    try {
      await api(`/api/process/stop`, {
        method: "POST",
        body: JSON.stringify({ projectId, serviceName: SERVICE_NAME }),
      });
    } catch {
      // no-op
    }

    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
    } catch {
      // no-op
    }
  }

  if (projectRoot) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("terminal reconnect + stopped logs behavior", async ({ page }) => {
  await page.goto("/");

  const projectItem = page.locator(".project-item", { hasText: PROJECT_NAME }).first();
  await expect(projectItem).toBeVisible();
  await projectItem.click();

  await expect(page.locator("#command-bar")).toBeVisible();
  const historyPanel = page.locator("#history-panel");
  await expect(historyPanel).toBeVisible();
  await page.locator("#cmd-start-btn").click();

  const serviceTab = page.locator(".terminal-tab", {
    hasText: SERVICE_NAME,
  });
  const tab = serviceTab.first();
  const tabStatus = tab.locator(".terminal-tab-status");

  await expect(tab).toBeVisible();
  await expect(tabStatus).toHaveText("live", { timeout: 15_000 });
  await expect(historyPanel).toContainText("start", { timeout: 15_000 });

  const serviceRunning = await getServiceState();
  expect(serviceRunning.running).toBeTruthy();
  const initialRunId = serviceRunning.runId;
  expect(initialRunId).toBeTruthy();

  await page.locator("#cmd-stop-btn").click();
  await expect(tabStatus).toHaveText(/stopped \(logs\)|disconnected/, { timeout: 15_000 });
  await expect(historyPanel).toContainText("stop", { timeout: 15_000 });

  await projectItem.click();
  await expect(tabStatus).toHaveText("stopped (logs)", { timeout: 15_000 });

  await expect(serviceTab).toHaveCount(1);

  await page.locator("#cmd-restart-btn").click();
  await expect(serviceTab).toHaveCount(1);
  await expect(tabStatus).toHaveText("live", { timeout: 15_000 });
  await expect(historyPanel).toContainText("restart", { timeout: 15_000 });

  const serviceAfterRestart = await getServiceState();
  expect(serviceAfterRestart.running).toBeTruthy();
  expect(serviceAfterRestart.runId).toBeTruthy();
  expect(serviceAfterRestart.runId).not.toBe(initialRunId);

  const history = await getHistory(0, 100);
  expect(history.retention).toBe(100);
  expect(history.latestSeq).toBeGreaterThan(0);
  expect(history.nextAfterSeq).toBe(history.latestSeq);
  expect(history.events.length).toBeGreaterThan(0);
  expect(history.events.some((event) => event.type === "start")).toBeTruthy();
  expect(history.events.some((event) => event.type === "stop_requested")).toBeTruthy();
  expect(history.events.some((event) => event.type === "restart_requested")).toBeTruthy();
  expect(history.events.some((event) => event.type === "exit")).toBeTruthy();

  const incremental = await getHistory(history.nextAfterSeq, 100);
  expect(incremental.events.length).toBe(0);
});
