import fs from "fs";
import path from "path";
import http, { type IncomingMessage } from "http";
import type { Socket } from "net";
import express, { type Response } from "express";
import next from "next";
import { WebSocketServer, type RawData } from "ws";
import { readRegistry, addProject, removeProject, getRegistryPath } from "./registry";
import {
  getProjectConfigPath,
  readProjectConfig,
  removeProjectConfig,
  writeProjectConfig,
} from "./config";
import { PortUnavailableError, ProcessManager } from "./processManager";
import type { ClientLogEntry, ProjectConfig, ProjectService, ProjectState, RegistryEntry } from "./types";

const PORT = Number(process.env.PORT || 4317);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clientLogWss = new WebSocketServer({ noServer: true });
const processes = new ProcessManager({ devrunPort: PORT });
const dev = process.env.NODE_ENV !== "production";
const projectRoot = process.cwd();
const nextApp = next({ dev, dir: projectRoot });
const handleNext = nextApp.getRequestHandler();

app.use(express.json({ limit: "1mb" }));

const CLIENT_LOG_MAX_RAW_BYTES = 16 * 1024;
const CLIENT_LOG_MAX_ENTRIES = 50;
const CLIENT_LOG_FIELD_MAX_CHARS = 2000;
const CLIENT_LOG_LEVELS = new Set(["debug", "log", "info", "warn", "error"]);
const CLIENT_LOG_SOURCES = new Set(["console", "window_error", "unhandledrejection"]);

function getUpgradePath(req: IncomingMessage): string {
  try {
    const baseUrl = `http://${req.headers.host || "localhost"}`;
    return new URL(req.url || "/", baseUrl).pathname;
  } catch {
    return "";
  }
}

server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const pathname = getUpgradePath(req);
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (pathname === "/ws/client-logs") {
    clientLogWss.handleUpgrade(req, socket, head, (ws) => {
      clientLogWss.emit("connection", ws, req);
    });
    return;
  }
  // Allow other upgrade listeners (e.g. Next.js dev tooling) to handle unmatched paths.
});

const LEGACY_LOCAL_STORAGE_CMD =
  "NODE_OPTIONS='--localstorage-file=.devrun-localstorage.json' npm run dev";

const DEFAULT_PROJECTS = [
  {
    name: "devrun-ui",
    root: "/Users/olof/git/codex-projects/devrun-ui",
    service: {
      name: "web",
      cmd: "npm run dev",
      port: 4327,
    } satisfies ProjectService,
  },
  {
    name: "youtube-blooper-app",
    root: "/Users/olof/git/youtube-looper",
    service: {
      name: "web",
      cmd: "npm run dev",
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
      (existing.services[0]?.cmd === "npm run dev" ||
        existing.services[0]?.cmd === LEGACY_LOCAL_STORAGE_CMD)
    ) {
      writeProjectConfig(project.id, {
        name: existing.name || project.name,
        defaultService: existing.defaultService || seed.service.name,
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
      defaultService: webService.name,
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

function getProjectByPath(projectPath: string): RegistryEntry | undefined {
  const resolvedPath = path.resolve(projectPath);
  const projects = readRegistry();

  const exact = projects.find((project) => project.root === resolvedPath);
  if (exact) {
    return exact;
  }

  const containing = projects
    .filter(
      (project) =>
        resolvedPath === project.root || resolvedPath.startsWith(`${project.root}${path.sep}`),
    )
    .sort((a, b) => b.root.length - a.root.length);

  return containing[0];
}

type ProjectResolveResult =
  | {
      ok: true;
      project: RegistryEntry;
    }
  | {
      ok: false;
      status: number;
      error: string;
      hint?: string;
    };

function resolveProjectFromLocator(input: {
  projectId?: unknown;
  projectPath?: unknown;
  cwd?: unknown;
}): ProjectResolveResult {
  const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
  const projectPathRaw =
    typeof input.projectPath === "string"
      ? input.projectPath.trim()
      : typeof input.cwd === "string"
        ? input.cwd.trim()
        : "";

  if (!projectId && !projectPathRaw) {
    return {
      ok: false,
      status: 400,
      error: "Missing project locator. Provide projectId or projectPath/cwd.",
      hint: "Use POST /api/process/start with { projectPath: \"/abs/path\" } for path-based start.",
    };
  }

  const projectById = projectId ? getProjectById(projectId) : undefined;
  if (projectId && !projectById) {
    return {
      ok: false,
      status: 404,
      error: "Project not found",
      hint: "Call GET /api/state to discover valid projectId values.",
    };
  }

  const projectByPath = projectPathRaw ? getProjectByPath(projectPathRaw) : undefined;
  if (projectPathRaw && !projectByPath) {
    return {
      ok: false,
      status: 404,
      error: "Project not found for projectPath/cwd",
      hint: "Add the project first via POST /api/projects, then retry with projectPath/cwd.",
    };
  }

  if (projectById && projectByPath && projectById.id !== projectByPath.id) {
    return {
      ok: false,
      status: 400,
      error: "projectId and projectPath/cwd resolved to different projects",
      hint: "Pass only one locator, or make both point to the same project.",
    };
  }

  const project = projectById || projectByPath;
  if (!project) {
    return {
      ok: false,
      status: 404,
      error: "Project not found",
      hint: "Call GET /api/state to discover registered projects.",
    };
  }

  return { ok: true, project };
}

function findService(config: ProjectConfig, serviceName: string) {
  return (
    config.services.find((entry) => entry.name === serviceName) ||
    config.services.find((entry) => entry.name.toLowerCase() === serviceName.toLowerCase()) ||
    null
  );
}

function resolveService(
  project: RegistryEntry,
  requestedServiceName: unknown,
): {
  config: ProjectConfig;
  service: ProjectService;
  serviceName: string;
  usedDefaultService: boolean;
} {
  const config = readProjectConfig(project.id);
  if (!config.services.length) {
    throw new Error(`No services configured for ${project.root}`);
  }

  const requested =
    typeof requestedServiceName === "string" ? requestedServiceName.trim() : "";
  const defaultName = config.defaultService || config.services[0].name;
  const targetName = requested || defaultName;
  const service = findService(config, targetName);
  if (!service) {
    throw new Error(`Service '${targetName}' not found in ${project.root}`);
  }

  return {
    config,
    service,
    serviceName: service.name,
    usedDefaultService: !requested,
  };
}

function buildProcessPayload(
  project: RegistryEntry,
  service: ProjectService,
  runInfo: ReturnType<ProcessManager["getRunInfo"]>,
  usedDefaultService: boolean,
) {
  const resolvedPort =
    typeof runInfo.port === "number"
      ? runInfo.port
      : typeof service.port === "number"
        ? service.port
        : null;
  return {
    projectId: project.id,
    projectPath: project.root,
    serviceName: service.name,
    usedDefaultService,
    running: runInfo.running,
    status: runInfo.status,
    ready: runInfo.ready,
    runId: runInfo.runId || runInfo.lastRunId || null,
    startedAt: runInfo.startedAt || null,
    terminalMode: runInfo.terminalMode || null,
    ptyAvailable:
      typeof runInfo.ptyAvailable === "boolean" ? runInfo.ptyAvailable : null,
    effectiveUrl: runInfo.effectiveUrl || null,
    port: resolvedPort,
    warnings: Array.isArray(runInfo.warnings) ? runInfo.warnings : [],
    lastExitCode:
      typeof runInfo.lastExitCode === "number" ? runInfo.lastExitCode : null,
    exitWasRestartReplace: Boolean(runInfo.exitWasRestartReplace),
    exitWasStopRequest: Boolean(runInfo.exitWasStopRequest),
    cmd: service.cmd,
    cwd: service.cwd || ".",
  };
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
      defaultService: config.defaultService,
      services: config.services.map((service) => {
        const runInfo = processes.getRunInfo(project.id, service.name);
        return {
          name: service.name,
          cmd: service.cmd,
          cwd: service.cwd,
          port:
            typeof runInfo.port === "number"
              ? runInfo.port
              : typeof service.port === "number"
                ? service.port
                : undefined,
          running: runInfo.running,
          status: runInfo.status,
          ready: runInfo.ready,
          runId: runInfo.runId,
          lastRunId: runInfo.lastRunId,
          startedAt: runInfo.startedAt,
          terminalMode: runInfo.terminalMode,
          ptyAvailable: runInfo.ptyAvailable,
          warnings: runInfo.warnings,
          effectiveUrl: runInfo.effectiveUrl,
          lastExitCode: runInfo.lastExitCode,
          exitWasRestartReplace: runInfo.exitWasRestartReplace,
          exitWasStopRequest: runInfo.exitWasStopRequest,
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

function parseIntegerQuery(
  raw: unknown,
  options: {
    name: string;
    defaultValue: number;
    min: number;
    max: number;
  },
) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: true as const, value: options.defaultValue };
  }

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    return {
      ok: false as const,
      error: `Invalid '${options.name}': expected an integer.`,
      hint: `Use '${options.name}' between ${options.min} and ${options.max}.`,
    };
  }

  if (value < options.min || value > options.max) {
    return {
      ok: false as const,
      error: `Invalid '${options.name}': must be between ${options.min} and ${options.max}.`,
      hint: `Try '${options.name}=${options.defaultValue}' for the default.`,
    };
  }

  return { ok: true as const, value };
}

function rawDataByteLength(raw: RawData): number {
  if (typeof raw === "string") {
    return Buffer.byteLength(raw);
  }
  if (raw instanceof Buffer) {
    return raw.byteLength;
  }
  if (Array.isArray(raw)) {
    return raw.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  }
  return raw.byteLength;
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Buffer) {
    return raw.toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw as ArrayBuffer).toString("utf8");
}

function sanitizeClientLogText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\s+/g, " ").trim().slice(0, CLIENT_LOG_FIELD_MAX_CHARS);
}

function normalizeClientLogTimestamp(input: unknown): string {
  if (typeof input !== "string") {
    return new Date().toISOString();
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function parseClientLogBatch(input: unknown) {
  if (!input || typeof input !== "object") {
    return { ok: false as const, error: "Malformed payload" };
  }

  const payload = input as { type?: unknown; entries?: unknown };
  if (payload.type !== "client_log_batch") {
    return { ok: false as const, error: "Unsupported client log message type" };
  }
  if (!Array.isArray(payload.entries)) {
    return { ok: false as const, error: "Missing entries array" };
  }
  if (payload.entries.length > CLIENT_LOG_MAX_ENTRIES) {
    return { ok: false as const, error: "Too many client log entries in one message" };
  }

  const entries: ClientLogEntry[] = [];
  for (const rawEntry of payload.entries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      return { ok: false as const, error: "Invalid client log entry" };
    }
    const entry = rawEntry as {
      level?: unknown;
      ts?: unknown;
      message?: unknown;
      path?: unknown;
      source?: unknown;
      clientId?: unknown;
    };
    const level = sanitizeClientLogText(entry.level).toLowerCase();
    const source = sanitizeClientLogText(entry.source).toLowerCase();
    if (!CLIENT_LOG_LEVELS.has(level)) {
      return { ok: false as const, error: `Invalid client log level '${level || "unknown"}'` };
    }
    if (!CLIENT_LOG_SOURCES.has(source)) {
      return { ok: false as const, error: `Invalid client log source '${source || "unknown"}'` };
    }

    entries.push({
      level: level as ClientLogEntry["level"],
      ts: normalizeClientLogTimestamp(entry.ts),
      message: sanitizeClientLogText(entry.message),
      path: sanitizeClientLogText(entry.path) || "/",
      source: source as ClientLogEntry["source"],
      clientId: sanitizeClientLogText(entry.clientId) || "unknown-client",
    });
  }

  return { ok: true as const, entries };
}

app.get("/api/state", (_req, res) => {
  res.json(buildState());
});

app.get("/api/capabilities", (_req, res) => {
  res.json({
    name: "devrun-ui",
    now: new Date().toISOString(),
    description:
      "Host-native multi-project service runner with PTY terminals and poll-friendly history/log APIs.",
    endpoints: {
      state: {
        method: "GET",
        path: "/api/state",
        description:
          "List projects, services, and currently running processes, including status/ready/runtime metadata.",
      },
      history: {
        method: "GET",
        path: "/api/history",
        query: {
          projectId: "optional string (projectId or projectPath/cwd required)",
          projectPath: "optional string (absolute or relative path)",
          cwd: "optional string alias for projectPath",
          serviceName: "optional string (defaults to project.defaultService)",
          afterSeq: "optional integer, default 0",
          limit: `optional integer, default 25, max ${processes.historyRetention()}`,
        },
        description:
          "Returns non-verbose lifecycle/command events (start, stop_requested, restart_requested, stdin_command, exit, client_log).",
      },
      logs: {
        method: "GET",
        path: "/api/logs",
        query: {
          projectId: "optional string (projectId or projectPath/cwd required)",
          projectPath: "optional string (absolute or relative path)",
          cwd: "optional string alias for projectPath",
          serviceName: "optional string (defaults to project.defaultService)",
          chars: "optional integer, default 4000",
          runId: "optional string",
        },
        description:
          "Returns terminal output tail. Use for verbose runtime logs, separate from event history.",
      },
      processControl: [
        {
          method: "POST",
          path: "/api/process/start",
          body: {
            projectId: "optional string",
            projectPath: "optional string",
            cwd: "optional string alias for projectPath",
            serviceName: "optional string (defaults to project.defaultService)",
          },
        },
        { method: "POST", path: "/api/process/stop" },
        { method: "POST", path: "/api/process/restart" },
        { method: "POST", path: "/api/process/stdin" },
        { method: "POST", path: "/api/process/cleanup-orphans" },
      ],
      ws: {
        method: "WS",
        path: "/ws",
        query: {
          projectId: "required string",
          serviceName: "required string",
          replay: "optional 1|0",
          runId: "optional string",
        },
      },
      clientLogWs: {
        method: "WS",
        path: "/ws/client-logs",
        query: {
          projectId: "required string",
          serviceName: "required string",
          runId: "required string (must match active run)",
        },
        message: {
          type: "client_log_batch",
          entries: `array (max ${CLIENT_LOG_MAX_ENTRIES}) of { level, ts, message, path, source, clientId }`,
        },
      },
    },
    pollingRecipe: [
      "Call GET /api/state to discover projects, defaultService, and runtime metadata.",
      "Start quickly with POST /api/process/start using projectPath or cwd.",
      "Call GET /api/history?projectPath=... (capture nextAfterSeq; omit serviceName to use defaultService).",
      "Poll GET /api/history?projectPath=...&afterSeq=<nextAfterSeq> for incremental events.",
      "Use status/ready fields to detect starting vs ready vs error without log scraping.",
      "Call POST /api/process/cleanup-orphans if runtime state looks desynced after crashes/restarts.",
      "Configured service ports are strict; start/restart returns HTTP 409 when the port is in use.",
      "Use GET /api/logs with runId for verbose output when needed.",
      "Use WS /ws/client-logs to forward browser-side logs into terminal/history for the active run.",
    ],
  });
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
  const defaultService =
    typeof req.body?.defaultService === "string" ? req.body.defaultService : undefined;
  const services = Array.isArray(req.body?.services) ? req.body.services : [];

  if (!projectId) {
    return badRequest(res, "Missing projectId");
  }

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    writeProjectConfig(projectId, { name, defaultService, services });
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
  processes.clearHistoryForProject(projectId);
  return res.status(204).send();
});

app.post("/api/process/start", async (req, res) => {
  let projectResult = resolveProjectFromLocator(req.body || {});
  if (!projectResult.ok) {
    const rawProjectPath =
      typeof req.body?.projectPath === "string"
        ? req.body.projectPath.trim()
        : typeof req.body?.cwd === "string"
          ? req.body.cwd.trim()
          : "";

    if (!req.body?.projectId && rawProjectPath) {
      const resolvedPath = path.resolve(rawProjectPath);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        const autoAdded = addProject(resolvedPath);
        ensureProjectHasConfig(autoAdded);
        projectResult = { ok: true, project: autoAdded };
      }
    }
  }

  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  try {
    const { project } = projectResult;
    const { service, usedDefaultService } = resolveService(project, req.body?.serviceName);
    await processes.start(project, service);
    const runInfo = processes.getRunInfo(project.id, service.name);
    return res.json({
      ok: true,
      action: "start",
      process: buildProcessPayload(project, service, runInfo, usedDefaultService),
    });
  } catch (error) {
    if (error instanceof PortUnavailableError) {
      return res.status(409).json({
        error: error.message,
      });
    }
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to start process",
    });
  }
});

app.post("/api/process/stop", (req, res) => {
  const projectResult = resolveProjectFromLocator(req.body || {});
  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  try {
    const { project } = projectResult;
    const { service, usedDefaultService } = resolveService(project, req.body?.serviceName);
    const stopped = processes.stop(project.id, service.name);
    const runInfo = processes.getRunInfo(project.id, service.name);
    return res.json({
      ok: stopped,
      action: "stop",
      process: buildProcessPayload(project, service, runInfo, usedDefaultService),
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to stop process",
    });
  }
});

app.post("/api/process/restart", async (req, res) => {
  const projectResult = resolveProjectFromLocator(req.body || {});
  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  try {
    const { project } = projectResult;
    const { service, usedDefaultService } = resolveService(project, req.body?.serviceName);
    await processes.restart(project, service);
    const runInfo = processes.getRunInfo(project.id, service.name);
    return res.json({
      ok: true,
      action: "restart",
      process: buildProcessPayload(project, service, runInfo, usedDefaultService),
    });
  } catch (error) {
    if (error instanceof PortUnavailableError) {
      return res.status(409).json({
        error: error.message,
      });
    }
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to restart process",
    });
  }
});

app.post("/api/process/stdin", (req, res) => {
  const projectResult = resolveProjectFromLocator(req.body || {});
  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  let service: ProjectService;
  let usedDefaultService = false;
  try {
    const resolved = resolveService(projectResult.project, req.body?.serviceName);
    service = resolved.service;
    usedDefaultService = resolved.usedDefaultService;
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to resolve service",
    });
  }

  const input = typeof req.body?.input === "string" ? req.body.input : "";
  const ok = processes.writeInput(projectResult.project.id, service.name, input);
  const runInfo = processes.getRunInfo(projectResult.project.id, service.name);
  return res.json({
    ok,
    action: "stdin",
    process: buildProcessPayload(
      projectResult.project,
      service,
      runInfo,
      usedDefaultService,
    ),
  });
});

app.post("/api/process/cleanup-orphans", async (_req, res) => {
  try {
    const report = await processes.cleanupOwnedOrphans();
    return res.json({
      ok: true,
      report,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to cleanup orphan processes",
    });
  }
});

app.get("/api/logs", (req, res) => {
  const projectResult = resolveProjectFromLocator({
    projectId: req.query.projectId,
    projectPath: req.query.projectPath,
    cwd: req.query.cwd,
  });
  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  let resolvedService: ReturnType<typeof resolveService>;
  try {
    resolvedService = resolveService(projectResult.project, req.query.serviceName);
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Service not found",
      hint: "Call GET /api/state and inspect project.services[].name/defaultService.",
    });
  }

  const charsRaw =
    typeof req.query.chars === "string" ? Number(req.query.chars) : 4000;
  const runId = typeof req.query.runId === "string" ? req.query.runId.trim() : "";
  const chars = Number.isFinite(charsRaw) ? Math.min(Math.max(charsRaw, 200), 50_000) : 4000;
  const runInfo = processes.getRunInfo(
    projectResult.project.id,
    resolvedService.service.name,
  );
  return res.json({
    projectId: projectResult.project.id,
    projectPath: projectResult.project.root,
    serviceName: resolvedService.service.name,
    usedDefaultService: resolvedService.usedDefaultService,
    chars,
    status: runInfo.status,
    ready: runInfo.ready,
    runId: runInfo.runId || runInfo.lastRunId || null,
    running: runInfo.running,
    terminalMode: runInfo.terminalMode || null,
    ptyAvailable:
      typeof runInfo.ptyAvailable === "boolean" ? runInfo.ptyAvailable : null,
    effectiveUrl: runInfo.effectiveUrl || null,
    port:
      typeof runInfo.port === "number"
        ? runInfo.port
        : typeof resolvedService.service.port === "number"
          ? resolvedService.service.port
          : null,
    warnings: Array.isArray(runInfo.warnings) ? runInfo.warnings : [],
    lastExitCode:
      typeof runInfo.lastExitCode === "number" ? runInfo.lastExitCode : null,
    exitWasRestartReplace: Boolean(runInfo.exitWasRestartReplace),
    exitWasStopRequest: Boolean(runInfo.exitWasStopRequest),
    output: processes.getLogTail(
      projectResult.project.id,
      resolvedService.service.name,
      chars,
      runId || undefined,
    ),
  });
});

app.get("/api/history", (req, res) => {
  const projectResult = resolveProjectFromLocator({
    projectId: req.query.projectId,
    projectPath: req.query.projectPath,
    cwd: req.query.cwd,
  });
  if (!projectResult.ok) {
    return res
      .status(projectResult.status)
      .json({ error: projectResult.error, hint: projectResult.hint });
  }

  let resolvedService: ReturnType<typeof resolveService>;
  try {
    resolvedService = resolveService(projectResult.project, req.query.serviceName);
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Service not found",
      hint: "Call GET /api/state and inspect project.services[].name/defaultService.",
    });
  }

  const afterSeqResult = parseIntegerQuery(req.query.afterSeq, {
    name: "afterSeq",
    defaultValue: 0,
    min: 0,
    max: 1_000_000_000,
  });
  if (!afterSeqResult.ok) {
    return res.status(400).json(afterSeqResult);
  }

  const limitResult = parseIntegerQuery(req.query.limit, {
    name: "limit",
    defaultValue: 25,
    min: 1,
    max: processes.historyRetention(),
  });
  if (!limitResult.ok) {
    return res.status(400).json(limitResult);
  }

  const afterSeq = afterSeqResult.value;
  const limit = limitResult.value;
  const projectId = projectResult.project.id;
  const serviceName = resolvedService.service.name;
  const runInfo = processes.getRunInfo(projectId, serviceName);
  const history = processes.getHistory(projectId, serviceName, afterSeq, limit);

  return res.json({
    projectId,
    projectPath: projectResult.project.root,
    serviceName,
    usedDefaultService: resolvedService.usedDefaultService,
    running: runInfo.running,
    status: runInfo.status,
    ready: runInfo.ready,
    runId: runInfo.runId || runInfo.lastRunId || null,
    startedAt: runInfo.startedAt || null,
    terminalMode: runInfo.terminalMode || null,
    ptyAvailable:
      typeof runInfo.ptyAvailable === "boolean" ? runInfo.ptyAvailable : null,
    effectiveUrl: runInfo.effectiveUrl || null,
    port:
      typeof runInfo.port === "number"
        ? runInfo.port
        : typeof resolvedService.service.port === "number"
          ? resolvedService.service.port
          : null,
    warnings: Array.isArray(runInfo.warnings) ? runInfo.warnings : [],
    lastExitCode:
      typeof runInfo.lastExitCode === "number" ? runInfo.lastExitCode : null,
    exitWasRestartReplace: Boolean(runInfo.exitWasRestartReplace),
    exitWasStopRequest: Boolean(runInfo.exitWasStopRequest),
    retention: processes.historyRetention(),
    afterSeq,
    limit,
    latestSeq: history.latestSeq,
    nextAfterSeq: history.nextAfterSeq,
    hasMore: history.hasMore,
    retained: history.retained,
    events: history.events,
    pollHint:
      history.nextAfterSeq > 0
        ? `/api/history?projectId=${encodeURIComponent(projectId)}&serviceName=${encodeURIComponent(serviceName)}&afterSeq=${history.nextAfterSeq}`
        : `/api/history?projectId=${encodeURIComponent(projectId)}&serviceName=${encodeURIComponent(serviceName)}`,
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

clientLogWss.on("connection", (ws, req: IncomingMessage) => {
  const baseUrl = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/ws/client-logs", baseUrl);
  const projectId = url.searchParams.get("projectId") || "";
  const serviceName = url.searchParams.get("serviceName") || "";
  const runId = url.searchParams.get("runId") || "";

  if (!projectId || !serviceName || !runId) {
    ws.close(1008, "Missing projectId/serviceName/runId");
    return;
  }

  const validated = processes.validateClientLogTarget(projectId, serviceName, runId);
  if (!validated.ok) {
    ws.close(1008, validated.error);
    return;
  }

  ws.on("message", (raw: RawData) => {
    if (rawDataByteLength(raw) > CLIENT_LOG_MAX_RAW_BYTES) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(raw));
    } catch {
      ws.close(1008, "Malformed client log payload");
      return;
    }

    const batch = parseClientLogBatch(parsed);
    if (!batch.ok) {
      ws.close(1008, batch.error);
      return;
    }

    const result = processes.ingestClientLogs(projectId, serviceName, runId, batch.entries);
    if (!result.ok) {
      ws.close(1008, result.error);
    }
  });
});

app.all("*", (req, res) => {
  void handleNext(req, res);
});

async function start() {
  await nextApp.prepare();
  const cleanup = await processes.cleanupOwnedOrphans();
  if (cleanup.inspected > 0 || cleanup.errors.length > 0) {
    console.log(
      `[devrun-ui] orphan cleanup inspected=${cleanup.inspected} terminated=${cleanup.terminated} missing=${cleanup.missing} retained=${cleanup.retained}`,
    );
    if (cleanup.errors.length > 0) {
      console.warn(`[devrun-ui] orphan cleanup errors: ${cleanup.errors.join("; ")}`);
    }
  }

  server.listen(PORT, () => {
    console.log(`[devrun-ui] listening on http://localhost:${PORT}`);
  });
}

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const SHUTDOWN_FORCE_EXIT_MS = 4500;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    console.warn(`[devrun-ui] received ${signal} during shutdown, forcing exit`);
    process.exit(130);
    return;
  }
  shuttingDown = true;
  const forceExitTimer = setTimeout(() => {
    console.warn(
      `[devrun-ui] shutdown exceeded ${SHUTDOWN_FORCE_EXIT_MS}ms, forcing exit`,
    );
    process.exit(1);
  }, SHUTDOWN_FORCE_EXIT_MS);
  forceExitTimer.unref();

  console.log(`[devrun-ui] received ${signal}, stopping managed processes...`);

  try {
    const result = await processes.stopAll();
    if (result.remaining > 0) {
      console.warn(
        `[devrun-ui] graceful shutdown stopped ${result.stopped}/${result.requested} managed service(s) before exit`,
      );
    } else if (result.requested > 0) {
      console.log(`[devrun-ui] stopped ${result.stopped} managed service(s)`);
    }
  } catch (error) {
    console.error("[devrun-ui] failed during graceful shutdown", error);
  } finally {
    clearTimeout(forceExitTimer);
    process.exit(0);
  }
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

start().catch((error) => {
  console.error("[devrun-ui] failed to start", error);
  process.exit(1);
});
