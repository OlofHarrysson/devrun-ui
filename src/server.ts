import fs from "fs";
import path from "path";
import http, { type IncomingMessage } from "http";
import express, { type Response } from "express";
import { WebSocketServer } from "ws";
import { readRegistry, addProject, removeProject, getRegistryPath } from "./registry";
import {
  getProjectConfigPath,
  readProjectConfig,
  removeProjectConfig,
  writeProjectConfig,
} from "./config";
import { ProcessManager } from "./processManager";
import type { ProjectService, ProjectState, RegistryEntry } from "./types";

const PORT = Number(process.env.PORT || 4317);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const processes = new ProcessManager();

app.use(express.json({ limit: "1mb" }));

const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

const DEFAULT_PROJECTS = [
  {
    name: "youtube-blooper-app",
    root: "/Users/olof/git/youtube-looper",
    service: {
      name: "web",
      cmd: "NODE_OPTIONS='--localstorage-file=.devrun-localstorage.json' npm run dev",
      cwd: "website",
    } satisfies ProjectService,
  },
  {
    name: "bluesky-scheduler",
    root: "/Users/olof/git/bluesky-scheduler",
  },
  {
    name: "chat-summary-viewer-mvp",
    root: "/Users/olof/git/codex-projects/chat-summary-viewer-mvp",
  },
];

function inferWebService(projectRoot: string): ProjectService | null {
  const candidates = [
    {
      packageJsonPath: path.join(projectRoot, "package.json"),
      cwd: undefined,
    },
    {
      packageJsonPath: path.join(projectRoot, "website", "package.json"),
      cwd: "website",
    },
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.packageJsonPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(candidate.packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as {
        scripts?: Record<string, string>;
      };
      const scripts = parsed.scripts || {};
      const cmd = scripts.dev ? "npm run dev" : scripts.start ? "npm run start" : "";
      if (!cmd) {
        continue;
      }

      return {
        name: "web",
        cmd,
        cwd: candidate.cwd,
      };
    } catch {
      // Ignore malformed package.json in auto-inference path.
    }
  }

  return null;
}

function ensureProjectHasConfig(project: RegistryEntry) {
  const seed = DEFAULT_PROJECTS.find((entry) => entry.root === project.root);

  try {
    const existing = readProjectConfig(project.id);
    if (
      seed?.service &&
      existing.services.length === 1 &&
      existing.services[0]?.name === "web" &&
      existing.services[0]?.cwd === "website" &&
      existing.services[0]?.cmd === "npm run dev"
    ) {
      writeProjectConfig(project.id, {
        name: existing.name || project.name,
        services: [seed.service],
      });
    }
    return;
  } catch {
    // No config yet. Attempt to auto-seed for quick concept testing.
  }

  const webService = seed?.service || inferWebService(project.root);
  if (!webService) {
    return;
  }

  try {
    writeProjectConfig(project.id, {
      name: project.name,
      services: [webService],
    });
  } catch {
    // Keep project visible even if seed write fails; user can configure manually.
  }
}

function seedDefaultProjects() {
  for (const seed of DEFAULT_PROJECTS) {
    if (!fs.existsSync(seed.root) || !fs.statSync(seed.root).isDirectory()) {
      continue;
    }

    const project = addProject(seed.root, seed.name);
    ensureProjectHasConfig(project);
  }
}

seedDefaultProjects();

function getProjectById(projectId: string): RegistryEntry | undefined {
  return readRegistry().find((project) => project.id === projectId);
}

function getService(project: RegistryEntry, serviceName: string): ProjectService {
  const config = readProjectConfig(project.id);
  const service = config.services.find((entry) => entry.name === serviceName);
  if (!service) {
    throw new Error(`Service '${serviceName}' not found in ${project.root}`);
  }

  return service;
}

function buildProjectState(project: RegistryEntry): ProjectState {
  const configPath = getProjectConfigPath();
  try {
    const config = readProjectConfig(project.id);
    return {
      id: project.id,
      name: config.name || project.name,
      root: project.root,
      configPath,
      services: config.services.map((service) => {
        const runInfo = processes.getRunInfo(project.id, service.name);
        return {
          name: service.name,
          cmd: service.cmd,
          cwd: service.cwd,
          running: runInfo.running,
          runId: runInfo.runId,
          lastRunId: runInfo.lastRunId,
        };
      }),
    };
  } catch (error) {
    return {
      id: project.id,
      name: project.name,
      root: project.root,
      configPath,
      services: [],
      configError: error instanceof Error ? error.message : "Unknown config error",
    };
  }
}

function buildState() {
  const projects = readRegistry().map(buildProjectState);
  return {
    now: new Date().toISOString(),
    registryPath: getRegistryPath(),
    projects,
    running: processes.listRunning(),
  };
}

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

app.get("/api/state", (_req, res) => {
  res.json(buildState());
});

app.get("/api/projects", (_req, res) => {
  res.json({ projects: readRegistry().map(buildProjectState) });
});

app.post("/api/projects", (req, res) => {
  const root = typeof req.body?.root === "string" ? req.body.root.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name : undefined;

  if (!root) {
    return badRequest(res, "Missing root path");
  }

  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    return badRequest(res, "Project root does not exist or is not a directory");
  }

  const project = addProject(resolvedRoot, name);
  ensureProjectHasConfig(project);
  return res.status(201).json({ project: buildProjectState(project) });
});

app.post("/api/project-config", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const name = typeof req.body?.name === "string" ? req.body.name : undefined;
  const services = Array.isArray(req.body?.services) ? req.body.services : [];

  if (!projectId) {
    return badRequest(res, "Missing projectId");
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    writeProjectConfig(projectId, { name, services });
    return res.json({ project: buildProjectState(project) });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save project config",
    });
  }
});

app.delete("/api/projects/:projectId", (req, res) => {
  const projectId = req.params.projectId;
  if (!projectId) {
    return badRequest(res, "Missing project id");
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    const config = readProjectConfig(project.id);
    for (const service of config.services) {
      processes.stop(project.id, service.name);
    }
  } catch {
    // Ignore invalid config while removing.
  }

  removeProject(projectId);
  removeProjectConfig(projectId);
  return res.status(204).send();
});

app.post("/api/process/start", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const serviceName =
    typeof req.body?.serviceName === "string" ? req.body.serviceName : "";

  if (!projectId || !serviceName) {
    return badRequest(res, "Missing projectId or serviceName");
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    const service = getService(project, serviceName);
    processes.start(project, service);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to start process",
    });
  }
});

app.post("/api/process/stop", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const serviceName =
    typeof req.body?.serviceName === "string" ? req.body.serviceName : "";

  if (!projectId || !serviceName) {
    return badRequest(res, "Missing projectId or serviceName");
  }

  const stopped = processes.stop(projectId, serviceName);
  return res.json({ ok: stopped });
});

app.post("/api/process/restart", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const serviceName =
    typeof req.body?.serviceName === "string" ? req.body.serviceName : "";

  if (!projectId || !serviceName) {
    return badRequest(res, "Missing projectId or serviceName");
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    const service = getService(project, serviceName);
    processes.restart(project, service);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to restart process",
    });
  }
});

app.post("/api/process/stdin", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const serviceName =
    typeof req.body?.serviceName === "string" ? req.body.serviceName : "";
  const input = typeof req.body?.input === "string" ? req.body.input : "";

  if (!projectId || !serviceName) {
    return badRequest(res, "Missing projectId or serviceName");
  }

  const ok = processes.writeInput(projectId, serviceName, input);
  return res.json({ ok });
});

app.get("/api/logs", (req, res) => {
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : "";
  const serviceName =
    typeof req.query.serviceName === "string" ? req.query.serviceName : "";
  const charsRaw =
    typeof req.query.chars === "string" ? Number(req.query.chars) : 4000;
  const runId = typeof req.query.runId === "string" ? req.query.runId.trim() : "";
  const chars = Number.isFinite(charsRaw) ? Math.min(Math.max(charsRaw, 200), 50_000) : 4000;

  if (!projectId || !serviceName) {
    return badRequest(res, "Missing projectId or serviceName");
  }

  const runInfo = processes.getRunInfo(projectId, serviceName);
  return res.json({
    projectId,
    serviceName,
    chars,
    runId: runInfo.runId || runInfo.lastRunId || null,
    output: processes.getLogTail(projectId, serviceName, chars, runId || undefined),
  });
});

app.post("/api/snapshot", (req, res) => {
  const charsRaw = typeof req.body?.chars === "number" ? req.body.chars : 1200;
  const chars = Math.min(Math.max(charsRaw, 200), 6000);
  const state = buildState();

  const logTails = state.running.map((proc) => ({
    projectId: proc.projectId,
    serviceName: proc.serviceName,
    runId: proc.runId,
    tail: processes.getLogTail(proc.projectId, proc.serviceName, chars),
  }));

  res.json({
    generatedAt: new Date().toISOString(),
    state,
    logTails,
  });
});

wss.on("connection", (ws, req: IncomingMessage) => {
  const baseUrl = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/ws", baseUrl);
  const projectId = url.searchParams.get("projectId") || "";
  const serviceName = url.searchParams.get("serviceName") || "";
  const replay = url.searchParams.get("replay") !== "0";
  const runId = url.searchParams.get("runId") || "";

  if (!projectId || !serviceName) {
    ws.close(1008, "Missing projectId/serviceName");
    return;
  }

  const attached = processes.attach(projectId, serviceName, ws, replay, runId || undefined);
  if (!attached.ok) {
    ws.send(JSON.stringify({ type: "error", error: attached.error }));
    ws.close(1008, attached.error);
    return;
  }

  ws.on("message", (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as
        | { type: "input"; data: string }
        | { type: "resize"; cols: number; rows: number };

      if (parsed.type === "input") {
        processes.writeInput(projectId, serviceName, parsed.data || "");
      }

      if (parsed.type === "resize") {
        processes.resize(projectId, serviceName, parsed.cols, parsed.rows);
      }
    } catch {
      // ignore malformed client messages
    }
  });

  ws.on("close", () => {
    processes.detach(projectId, serviceName, ws);
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

server.listen(PORT, () => {
  console.log(`[devrun-ui] listening on http://localhost:${PORT}`);
});
