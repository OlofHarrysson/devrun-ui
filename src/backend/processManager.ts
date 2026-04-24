import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import http from "http";
import https from "https";
import net from "net";
import { spawn as spawnChild } from "child_process";
import type { WebSocket } from "ws";
import type {
  ProjectService,
  RegistryEntry,
  ServiceHistoryEventType,
  ServiceStatus,
} from "./types";
import {
  findReservedPortOwner,
  getPortAssignment,
  listReservedPorts,
  prunePortAssignments,
  setAssignedPort,
} from "./portReservations";
import { ServiceHistoryStore } from "./historyStore";
import { DEVRUN_HOME } from "./storage";

type ProcessRunner = {
  write: (input: string) => void;
  resize: (cols: number, rows: number) => void;
  interrupt: () => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number) => void) => void;
  mode: "pipe";
  pid?: number;
};

type RuntimeMetadata = {
  terminalMode: "pipe";
  ptyAvailable: boolean;
  warnings: string[];
  effectiveUrl?: string;
  port?: number;
  requestedPort?: number;
  readyHintSeen: boolean;
};

type RunInfo = {
  runId?: string;
  lastRunId?: string;
  running: boolean;
  status: ServiceStatus;
  ready: boolean;
  startedAt?: string;
  terminalMode?: "pipe";
  ptyAvailable?: boolean;
  warnings: string[];
  effectiveUrl?: string;
  port?: number;
  requestedPort?: number;
  lastExitCode?: number;
  exitWasRestartReplace: boolean;
  exitWasStopRequest: boolean;
};

type Session = {
  key: string;
  projectId: string;
  serviceName: string;
  runId: string;
  launchPort?: number;
  runner: ProcessRunner;
  startedAt: string;
  logBuffer: string;
  clients: Set<WebSocket>;
  inputBuffer: string;
  runtime: RuntimeMetadata;
  warningKeys: Set<string>;
  detectedUrls: string[];
  stopRequested: boolean;
  urlProbeInFlight: boolean;
};

type RecentLog = {
  runId: string;
  logBuffer: string;
  exitCode: number;
  exitedAt: string;
  startedAt: string;
  runtime: RuntimeMetadata;
  exitWasRestartReplace: boolean;
  exitWasStopRequest: boolean;
};

type LaunchPortResolution = {
  port: number;
  requestedPort: number;
  previousAssignedPort?: number;
};

type OwnedRunRecord = {
  runId: string;
  projectId: string;
  serviceName: string;
  projectRoot: string;
  cmd: string;
  cwd: string;
  startedAt: string;
  pid: number;
  mode: "pty" | "pipe";
};

export type OrphanCleanupReport = {
  inspected: number;
  terminated: number;
  missing: number;
  skippedActive: number;
  retained: number;
  errors: string[];
};

const MAX_LOG_CHARS = 120_000;
const MAX_RECENT_LOGS = 100;
const HISTORY_RETENTION = 100;
const READY_GRACE_MS = 2500;
const LOCAL_STORAGE_RUNTIME_DIR = path.join(DEVRUN_HOME, "runtime", "localstorage");
const OWNED_RUNS_PATH = path.join(DEVRUN_HOME, "runtime", "owned-runs.json");
const RESTART_PORT_RELEASE_TIMEOUT_MS = 4000;
const PORT_RELEASE_POLL_MS = 120;
const STOP_KILL_TIMEOUT_MS = 1200;
const STOP_ALL_WAIT_TIMEOUT_MS = 6000;
const STOP_ALL_POLL_MS = 50;
const ORPHAN_TERM_TIMEOUT_MS = 1600;
const ORPHAN_KILL_TIMEOUT_MS = 1200;
const PROCESS_EXIT_POLL_MS = 120;
const AUTO_PORT_START = 3000;
const AUTO_PORT_END = 65535;
const LOCAL_URL_PROBE_TIMEOUT_MS = 1000;
const LOCAL_URL_PROBE_RETRIES = 8;
const LOCAL_URL_PROBE_RETRY_MS = 400;
const LOOPBACK_PORT_HOSTS = ["127.0.0.1", "::1"] as const;
const LOCAL_URL_FALLBACK_HOSTS = ["127.0.0.1", "::1"] as const;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeKey(projectId: string, serviceName: string) {
  return `${projectId}::${serviceName}`;
}

function marker(text: string, at = new Date().toISOString()) {
  return `[${at}] ${text}\n`;
}

function trimPunctuation(raw: string) {
  return raw.replace(/[),.;]+$/g, "");
}

function normalizeUrl(raw: string) {
  try {
    const parsed = new URL(trimPunctuation(raw));
    if (!/^https?:$/.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function parseUrls(chunk: string) {
  const matches = chunk.match(/https?:\/\/[^\s"'`<>]+/gi) || [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const normalized = normalizeUrl(match);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function isLocalHostUrl(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "0.0.0.0" ||
      parsed.hostname === "::" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

function chooseEffectiveUrl(urls: string[]) {
  if (!urls.length) {
    return undefined;
  }
  const latestLocal = [...urls].reverse().find((url) => isLocalHostUrl(url));
  return latestLocal || urls[urls.length - 1];
}

function getLocalUrlPort(url: string) {
  try {
    const parsed = new URL(url);
    if (!isLocalHostUrl(url)) {
      return undefined;
    }
    const value = Number(parsed.port);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function formatLocalUrl(protocol: string, host: string, port: number, pathName = "/") {
  const normalizedPath = pathName.startsWith("/") ? pathName : `/${pathName}`;
  const hostLabel = host.includes(":") ? `[${host}]` : host;
  return `${protocol}//${hostLabel}:${port}${normalizedPath}`;
}

function buildLocalUrlProbeCandidates(session: Session) {
  if (typeof session.launchPort !== "number") {
    return [];
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (url: string) => {
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    candidates.push(url);
  };

  for (const detectedUrl of session.detectedUrls) {
    try {
      const parsed = new URL(detectedUrl);
      if (!/^https?:$/.test(parsed.protocol) || !isLocalHostUrl(detectedUrl)) {
        continue;
      }
      const pathName = `${parsed.pathname || "/"}${parsed.search || ""}`;
      addCandidate(formatLocalUrl(parsed.protocol, "localhost", session.launchPort, pathName));
      for (const host of LOCAL_URL_FALLBACK_HOSTS) {
        addCandidate(formatLocalUrl(parsed.protocol, host, session.launchPort, pathName));
      }
    } catch {
      // Ignore malformed URL candidates from logs.
    }
  }

  if (!candidates.length) {
    addCandidate(formatLocalUrl("http:", "localhost", session.launchPort));
    for (const host of LOCAL_URL_FALLBACK_HOSTS) {
      addCandidate(formatLocalUrl("http:", host, session.launchPort));
    }
  }

  return candidates;
}

function parseWarningLines(chunk: string) {
  const warnings: string[] = [];
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (
      /(EADDRINUSE|address already in use|port\s+\d+.*(in use|already)|trying\s+\d+)/i.test(
        trimmed,
      )
    ) {
      warnings.push(trimmed.slice(0, 260));
    }
  }
  return warnings;
}

function hasReadySignal(chunk: string) {
  return /(local:\s*https?:\/\/|listening on|ready in|compiled successfully|server started|started server|ready on)/i.test(
    chunk,
  );
}

function sanitizePathSegment(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

function ensureNodeLocalStorageFile(
  env: NodeJS.ProcessEnv,
  projectId: string,
  serviceName: string,
) {
  const existing = env.NODE_OPTIONS || "";
  if (/(?:^|\s)--localstorage-file(?:=|\s|$)/.test(existing)) {
    return;
  }

  fs.mkdirSync(LOCAL_STORAGE_RUNTIME_DIR, { recursive: true });
  const fileName = `${sanitizePathSegment(projectId)}--${sanitizePathSegment(serviceName)}.sqlite`;
  const filePath = path.join(LOCAL_STORAGE_RUNTIME_DIR, fileName);
  const option = `--localstorage-file=${filePath}`;
  env.NODE_OPTIONS = existing.trim() ? `${existing.trim()} ${option}` : option;
}

function buildChildEnv(
  projectId: string,
  serviceName: string,
  configuredPort?: number,
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Avoid inheriting server port into child apps (can collide with Devrun itself).
  delete env.PORT;
  if (typeof configuredPort === "number") {
    env.PORT = String(configuredPort);
  }
  ensureNodeLocalStorageFile(env, projectId, serviceName);
  return env;
}

export class PortUnavailableError extends Error {
  port: number;

  constructor(port: number, message = `Configured port ${port} is already in use.`) {
    super(message);
    this.name = "PortUnavailableError";
    this.port = port;
  }
}

type HostPortProbeResult = "available" | "occupied" | "unsupported";

async function probePortAvailabilityOnHost(
  port: number,
  host: (typeof LOOPBACK_PORT_HOSTS)[number],
): Promise<HostPortProbeResult> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();

    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve("occupied");
        return;
      }
      if (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT") {
        resolve("unsupported");
        return;
      }
      reject(error);
    });

    probe.listen(
      {
        host,
        port,
        ...(host === "::1" ? { ipv6Only: true } : {}),
      },
      () => {
        probe.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve("available");
        });
      },
    );
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  const results = await Promise.all(
    LOOPBACK_PORT_HOSTS.map((host) => probePortAvailabilityOnHost(port, host)),
  );
  return !results.includes("occupied");
}

async function ensurePortIsAvailable(port: number) {
  let available = false;
  try {
    available = await isPortAvailable(port);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate configured port ${port}: ${message}`);
  }

  if (!available) {
    throw new PortUnavailableError(port);
  }
}

async function waitForPortRelease(port: number, timeoutMs = RESTART_PORT_RELEASE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await isPortAvailable(port)) {
        return;
      }
    } catch {
      // Keep retrying for transient probe errors.
    }
    await sleep(PORT_RELEASE_POLL_MS);
  }
  throw new PortUnavailableError(port);
}

function getUrlHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isLocalhostName(url: string) {
  return getUrlHostname(url) === "localhost";
}

function isNumericLoopbackName(url: string) {
  const hostname = getUrlHostname(url);
  return hostname === "127.0.0.1" || hostname === "::1";
}

async function probeHttpStatus(url: string, timeoutMs = LOCAL_URL_PROBE_TIMEOUT_MS) {
  let settled = false;
  return new Promise<number | undefined>((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(undefined);
      return;
    }

    const requestFn = parsed.protocol === "https:" ? https.request : http.request;
    const request = requestFn(
      parsed,
      {
        method: "GET",
      },
      (response) => {
        response.resume();
        if (settled) {
          return;
        }
        settled = true;
        resolve(response.statusCode);
      },
    );

    request.once("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(undefined);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      if (settled) {
        return;
      }
      settled = true;
      resolve(undefined);
    });

    request.end();
  });
}

function signalPidOrGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // fallback to direct pid signal
    }
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    if (code === "ESRCH") {
      return false;
    }
    // Treat permission errors as "process exists but inaccessible".
    return true;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    await sleep(PROCESS_EXIT_POLL_MS);
  }
  return !processExists(pid);
}

async function terminateProcessGroup(pid: number): Promise<boolean> {
  if (!processExists(pid)) {
    return true;
  }

  signalPidOrGroup(pid, "SIGTERM");
  if (await waitForProcessExit(pid, ORPHAN_TERM_TIMEOUT_MS)) {
    return true;
  }

  signalPidOrGroup(pid, "SIGKILL");
  return waitForProcessExit(pid, ORPHAN_KILL_TIMEOUT_MS);
}

function readOwnedRunsFile(): OwnedRunRecord[] {
  if (!fs.existsSync(OWNED_RUNS_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(OWNED_RUNS_PATH, "utf8");
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw) as { runs?: unknown };
    const runs = Array.isArray(parsed.runs) ? parsed.runs : [];

    return runs
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const candidate = entry as Partial<OwnedRunRecord>;
        if (
          typeof candidate.runId !== "string" ||
          typeof candidate.projectId !== "string" ||
          typeof candidate.serviceName !== "string" ||
          typeof candidate.projectRoot !== "string" ||
          typeof candidate.cmd !== "string" ||
          typeof candidate.cwd !== "string" ||
          typeof candidate.startedAt !== "string" ||
          typeof candidate.pid !== "number" ||
          !Number.isInteger(candidate.pid) ||
          candidate.pid <= 0 ||
          (candidate.mode !== "pty" && candidate.mode !== "pipe")
        ) {
          return null;
        }
        return candidate as OwnedRunRecord;
      })
      .filter((entry): entry is OwnedRunRecord => Boolean(entry));
  } catch {
    return [];
  }
}

function writeOwnedRunsFile(runs: OwnedRunRecord[]) {
  fs.mkdirSync(path.dirname(OWNED_RUNS_PATH), { recursive: true });
  fs.writeFileSync(
    OWNED_RUNS_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        runs,
      },
      null,
      2,
    ),
  );
}

function createPipeRunner(
  shell: string,
  command: string,
  cwd: string,
  projectId: string,
  serviceName: string,
  configuredPort?: number,
): ProcessRunner {
  const child = spawnChild(shell, ["-lc", command], {
    cwd,
    env: buildChildEnv(projectId, serviceName, configuredPort),
    stdio: "pipe",
    detached: process.platform !== "win32",
  });

  return {
    write(input) {
      child.stdin?.write(input);
    },
    resize() {
      // Not supported in pipe mode.
    },
    interrupt() {
      if (!signalPidOrGroup(child.pid, "SIGINT")) {
        try {
          child.kill("SIGINT");
        } catch {
          // no-op
        }
      }
    },
    kill() {
      if (!signalPidOrGroup(child.pid, "SIGKILL")) {
        try {
          child.kill("SIGKILL");
        } catch {
          // no-op
        }
      }
    },
    onData(listener) {
      child.stdout?.on("data", (chunk: Buffer | string) => {
        listener(chunk.toString());
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        listener(chunk.toString());
      });
    },
    onExit(listener) {
      child.on("exit", (code) => {
        listener(typeof code === "number" ? code : 1);
      });
    },
    mode: "pipe",
    pid: typeof child.pid === "number" ? child.pid : undefined,
  };
}

export class ProcessManager {
  private sessions = new Map<string, Session>();
  private recentLogs = new Map<string, RecentLog>();
  private replacedRunIds = new Set<string>();
  private history = new ServiceHistoryStore({ retention: HISTORY_RETENTION });
  private portReservationChain: Promise<void> = Promise.resolve();

  constructor() {
    prunePortAssignments();
  }

  isRunning(projectId: string, serviceName: string) {
    return this.sessions.has(makeKey(projectId, serviceName));
  }

  listRunning() {
    return Array.from(this.sessions.values()).map((session) => {
      const status = this.getSessionStatus(session);
      return {
        projectId: session.projectId,
        serviceName: session.serviceName,
        startedAt: session.startedAt,
        runId: session.runId,
        status,
        ready: status === "ready",
        terminalMode: session.runtime.terminalMode,
        ptyAvailable: session.runtime.ptyAvailable,
        warnings: [...session.runtime.warnings],
        effectiveUrl: session.runtime.effectiveUrl,
        port: session.runtime.port,
      };
    });
  }

  historyRetention() {
    return this.history.retention;
  }

  getHistory(projectId: string, serviceName: string, afterSeq = 0, limit = 50) {
    return this.history.list(projectId, serviceName, afterSeq, limit);
  }

  clearHistoryForProject(projectId: string) {
    this.history.clearProject(projectId);
  }

  syncPortReservations() {
    prunePortAssignments();
  }

  private async withPortReservationLock<T>(work: () => Promise<T>) {
    const previous = this.portReservationChain;
    let release: (() => void) | undefined;
    this.portReservationChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  private appendWarning(session: Session, warning: string) {
    const normalized = warning.trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (session.warningKeys.has(key)) {
      return;
    }
    session.warningKeys.add(key);
    session.runtime.warnings.push(normalized.slice(0, 260));
    if (session.runtime.warnings.length > 12) {
      session.runtime.warnings = session.runtime.warnings.slice(-12);
    }
  }

  private async findAvailableAutoPort(
    projectId: string,
    serviceName: string,
    startPort: number,
  ) {
    const reservedByOthers = new Set<number>();
    for (const owner of listReservedPorts()) {
      if (owner.projectId === projectId && owner.serviceName === serviceName) {
        continue;
      }
      reservedByOthers.add(owner.port);
    }

    for (let port = startPort; port <= AUTO_PORT_END; port += 1) {
      if (reservedByOthers.has(port)) {
        continue;
      }
      if (await isPortAvailable(port)) {
        return port;
      }
    }

    throw new Error(
      `No free auto-assigned ports available in range ${startPort}-${AUTO_PORT_END}.`,
    );
  }

  private async resolveLaunchPort(
    project: RegistryEntry,
    service: ProjectService,
  ): Promise<LaunchPortResolution> {
    prunePortAssignments();

    const requestedPort = service.port || AUTO_PORT_START;

    if (typeof service.port === "number" && service.portMode === "exact") {
      const owner = findReservedPortOwner(service.port, {
        projectId: project.id,
        serviceName: service.name,
      });
      if (owner) {
        throw new PortUnavailableError(
          service.port,
          `Configured port ${service.port} is already reserved by ${owner.projectId}/${owner.serviceName}.`,
        );
      }
      await ensurePortIsAvailable(service.port);
      setAssignedPort(project.id, service.name, service.port, requestedPort);
      return {
        port: service.port,
        requestedPort,
      };
    }

    const previousAssignment = getPortAssignment(project.id, service.name);
    const previousAssignedPort =
      previousAssignment &&
      ((previousAssignment.preferredPort === undefined && typeof service.port !== "number") ||
        previousAssignment.preferredPort === requestedPort)
        ? previousAssignment.port
        : undefined;
    if (typeof previousAssignedPort === "number") {
      const owner = findReservedPortOwner(previousAssignedPort, {
        projectId: project.id,
        serviceName: service.name,
      });
      if (!owner && (await isPortAvailable(previousAssignedPort))) {
        return {
          port: previousAssignedPort,
          requestedPort,
        };
      }
    }

    const nextPort = await this.findAvailableAutoPort(
      project.id,
      service.name,
      requestedPort,
    );
    setAssignedPort(project.id, service.name, nextPort, requestedPort);
    return {
      port: nextPort,
      requestedPort,
      previousAssignedPort:
        typeof previousAssignedPort === "number" && previousAssignedPort !== nextPort
          ? previousAssignedPort
          : undefined,
    };
  }

  private async verifyLocalEffectiveUrl(session: Session) {
    if (session.urlProbeInFlight || session.runtime.effectiveUrl) {
      return;
    }
    if (typeof session.launchPort !== "number") {
      return;
    }

    session.urlProbeInFlight = true;
    try {
      for (let attempt = 0; attempt < LOCAL_URL_PROBE_RETRIES; attempt += 1) {
        if (this.sessions.get(session.key) !== session) {
          return;
        }

        const candidates = buildLocalUrlProbeCandidates(session);
        const probeResults = new Map<string, number | undefined>();
        for (const candidate of candidates) {
          probeResults.set(candidate, await probeHttpStatus(candidate));
        }

        const localhostCandidate = candidates.find((candidate) =>
          isLocalhostName(candidate),
        );
        const numericSuccesses = candidates
          .filter((candidate) => isNumericLoopbackName(candidate))
          .map((candidate) => ({
            url: candidate,
            status: probeResults.get(candidate),
          }))
          .filter(
            (result): result is { url: string; status: number } =>
              typeof result.status === "number",
          );
        const numericStatusCodes = new Set(
          numericSuccesses.map((result) => result.status),
        );
        const localhostStatus = localhostCandidate
          ? probeResults.get(localhostCandidate)
          : undefined;
        const localhostLooksSafe =
          typeof localhostStatus === "number" && numericStatusCodes.size <= 1;

        let effectiveUrl = localhostLooksSafe ? localhostCandidate : undefined;
        if (!effectiveUrl) {
          const numericFallback =
            numericSuccesses.find((result) => result.status < 400) ||
            numericSuccesses[0];
          effectiveUrl = numericFallback?.url;
        }

        if (!effectiveUrl) {
          await sleep(LOCAL_URL_PROBE_RETRY_MS);
          continue;
        }

        if (this.sessions.get(session.key) !== session) {
          return;
        }
        if (localhostCandidate && effectiveUrl !== localhostCandidate) {
          this.appendWarning(
            session,
            `localhost:${session.launchPort} resolved differently across IPv4/IPv6; using ${effectiveUrl}.`,
          );
        }
        session.runtime.effectiveUrl = effectiveUrl;
        session.runtime.port = session.launchPort;
        return;
      }
    } finally {
      session.urlProbeInFlight = false;
    }
  }

  private broadcastOutput(session: Session, data: string) {
    if (!data) {
      return;
    }

    for (const client of session.clients) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: "output", data }));
      }
    }
  }

  private saveOwnedRun(entry: OwnedRunRecord) {
    const current = readOwnedRunsFile();
    const filtered = current.filter(
      (candidate) =>
        !(
          candidate.projectId === entry.projectId &&
          candidate.serviceName === entry.serviceName
        ),
    );
    filtered.push(entry);
    writeOwnedRunsFile(filtered);
  }

  private removeOwnedRun(runId: string) {
    if (!runId) {
      return;
    }
    const current = readOwnedRunsFile();
    const filtered = current.filter((candidate) => candidate.runId !== runId);
    if (filtered.length === current.length) {
      return;
    }
    writeOwnedRunsFile(filtered);
  }

  async cleanupOwnedOrphans(): Promise<OrphanCleanupReport> {
    const runs = readOwnedRunsFile();
    const activeRunIds = new Set<string>(
      Array.from(this.sessions.values()).map((session) => session.runId),
    );
    const keep: OwnedRunRecord[] = [];
    const report: OrphanCleanupReport = {
      inspected: 0,
      terminated: 0,
      missing: 0,
      skippedActive: 0,
      retained: 0,
      errors: [],
    };

    for (const run of runs) {
      if (activeRunIds.has(run.runId)) {
        report.skippedActive += 1;
        keep.push(run);
        continue;
      }

      report.inspected += 1;
      if (!processExists(run.pid)) {
        report.missing += 1;
        continue;
      }

      const killed = await terminateProcessGroup(run.pid);
      if (killed) {
        report.terminated += 1;
      } else {
        report.errors.push(
          `${run.projectId}/${run.serviceName} pid ${run.pid} could not be terminated`,
        );
        keep.push(run);
      }
    }

    report.retained = keep.length;
    writeOwnedRunsFile(keep);
    return report;
  }

  private recordHistory(
    projectId: string,
    serviceName: string,
    type: ServiceHistoryEventType,
    options?: {
      runId?: string;
      data?: Record<string, unknown>;
    },
  ) {
    this.history.append({
      projectId,
      serviceName,
      type,
      runId: options?.runId,
      data: options?.data,
    });
  }

  private appendLog(session: Session, chunk: string) {
    session.logBuffer = `${session.logBuffer}${chunk}`;
    if (session.logBuffer.length > MAX_LOG_CHARS) {
      session.logBuffer = session.logBuffer.slice(
        session.logBuffer.length - MAX_LOG_CHARS,
      );
    }
  }

  private isSessionReady(session: Session) {
    if (session.runtime.readyHintSeen || session.runtime.effectiveUrl) {
      return true;
    }
    const startedMs = Date.parse(session.startedAt);
    if (!Number.isFinite(startedMs)) {
      return false;
    }
    return Date.now() - startedMs >= READY_GRACE_MS;
  }

  private getSessionStatus(session: Session): ServiceStatus {
    return this.isSessionReady(session) ? "ready" : "starting";
  }

  private getRecentStatus(recent?: RecentLog): ServiceStatus {
    if (!recent) {
      return "stopped";
    }
    if (
      recent.exitCode !== 0 &&
      !recent.exitWasRestartReplace &&
      !recent.exitWasStopRequest
    ) {
      return "error";
    }
    return "stopped";
  }

  private updateRuntimeMetadata(session: Session, chunk: string) {
    const urls = parseUrls(chunk);
    for (const url of urls) {
      if (session.detectedUrls.includes(url)) {
        continue;
      }
      session.detectedUrls.push(url);
      if (session.detectedUrls.length > 20) {
        session.detectedUrls = session.detectedUrls.slice(-20);
      }
    }

    if (!session.runtime.readyHintSeen && (urls.length > 0 || hasReadySignal(chunk))) {
      session.runtime.readyHintSeen = true;
    }

    const warningLines = parseWarningLines(chunk);
    for (const warning of warningLines) {
      this.appendWarning(session, warning);
    }

    if (typeof session.launchPort === "number") {
      for (const url of urls) {
        const detectedPort = getLocalUrlPort(url);
        if (
          typeof detectedPort === "number" &&
          detectedPort !== session.launchPort
        ) {
          this.appendWarning(
            session,
            `Service announced local port ${detectedPort} but Devrun assigned ${session.launchPort}. The process may be ignoring PORT; configure the command or explicit port.`,
          );
        }
      }
      void this.verifyLocalEffectiveUrl(session);
    }
  }

  private trackInput(session: Session, input: string) {
    if (!input) {
      return;
    }

    // Drop common ANSI escape sequences (e.g. arrow keys) so command capture stays clean.
    const sanitized = input.replace(/\u001b\[[0-9;?]*[A-Za-z~]/g, "");

    for (const ch of sanitized) {
      if (ch === "\r" || ch === "\n") {
        const command = session.inputBuffer.trim();
        if (command) {
          this.recordHistory(session.projectId, session.serviceName, "stdin_command", {
            runId: session.runId,
            data: { command },
          });
        }
        session.inputBuffer = "";
        continue;
      }

      if (ch === "\u007f" || ch === "\b") {
        session.inputBuffer = session.inputBuffer.slice(0, -1);
        continue;
      }

      if (ch < " " || ch === "\u001b") {
        continue;
      }

      session.inputBuffer = `${session.inputBuffer}${ch}`.slice(-2000);
    }
  }

  async start(project: RegistryEntry, service: ProjectService): Promise<Session> {
    return this.withPortReservationLock(async () => {
      const key = makeKey(project.id, service.name);
      const existing = this.sessions.get(key);
      if (existing) {
        return existing;
      }
      this.recentLogs.delete(key);

      const launch = await this.resolveLaunchPort(project, service);
      const launchPort = launch.port;
      const requestedPort = launch.requestedPort;
      const shell = process.env.SHELL || "/bin/zsh";
      const cwd = service.cwd
        ? path.resolve(project.root, service.cwd)
        : project.root;
      const runId = randomUUID();
      const startedAt = new Date().toISOString();

      const runner = createPipeRunner(
        shell,
        service.cmd,
        cwd,
        project.id,
        service.name,
        launchPort,
      );
      const session: Session = {
        key,
        projectId: project.id,
        serviceName: service.name,
        runId,
        launchPort,
        runner,
        startedAt,
        logBuffer: `${marker(`[run ${runId}]`, startedAt)}${marker(`$ ${service.cmd}`, startedAt)}`,
        clients: new Set<WebSocket>(),
        inputBuffer: "",
        runtime: {
          terminalMode: runner.mode,
          ptyAvailable: false,
          warnings: [],
          readyHintSeen: false,
          requestedPort,
        },
        warningKeys: new Set<string>(),
        detectedUrls: [],
        stopRequested: false,
        urlProbeInFlight: false,
      };

      if (launchPort !== requestedPort) {
        this.appendWarning(
          session,
          `Preferred port ${requestedPort} was unavailable; assigned ${launchPort}.`,
        );
      }
      if (typeof launch.previousAssignedPort === "number") {
        this.appendWarning(
          session,
          `Previously assigned port ${launch.previousAssignedPort} was unavailable; reassigned to ${launchPort}.`,
        );
      }

      if (typeof runner.pid === "number" && Number.isInteger(runner.pid) && runner.pid > 0) {
        this.saveOwnedRun({
          runId,
          projectId: project.id,
          serviceName: service.name,
          projectRoot: project.root,
          cmd: service.cmd,
          cwd,
          startedAt,
          pid: runner.pid,
          mode: runner.mode,
        });
      }

      this.recordHistory(project.id, service.name, "start", {
        runId,
        data: {
          cmd: service.cmd,
          cwd: service.cwd || ".",
          requestedPort,
          ...(typeof launchPort === "number" ? { port: launchPort } : {}),
          mode: runner.mode,
          ptyAvailable: false,
        },
      });

      runner.onData((data) => {
        this.appendLog(session, data);
        this.updateRuntimeMetadata(session, data);
        this.broadcastOutput(session, data);
      });

      runner.onExit((exitCode) => {
        this.removeOwnedRun(session.runId);
        const replacedByRestart = this.replacedRunIds.delete(session.runId);
        const stopRequested = session.stopRequested;
        const needsNewline = session.logBuffer && !session.logBuffer.endsWith("\n");
        const msg = `${needsNewline ? "\n" : ""}${marker(`[process exited ${exitCode}]`)}`;
        this.appendLog(session, msg);
        this.recordHistory(session.projectId, session.serviceName, "exit", {
          runId: session.runId,
          data: {
            exitCode,
            ...(stopRequested ? { stopRequested: true } : {}),
            ...(replacedByRestart ? { replacedByRestart: true } : {}),
          },
        });

        for (const client of session.clients) {
          if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({ type: "output", data: msg }));
            client.send(JSON.stringify({ type: "exited", exitCode, runId: session.runId }));
          }
          try {
            client.close(1000, "Process exited");
          } catch {
            // ignore close race
          }
        }
        session.clients.clear();

        // Guard against restart races: only remove this key if it still points to this session.
        if (this.sessions.get(key) === session) {
          this.sessions.delete(key);
        }
        this.recentLogs.set(key, {
          runId: session.runId,
          logBuffer: session.logBuffer.slice(-MAX_LOG_CHARS),
          exitCode,
          exitedAt: new Date().toISOString(),
          startedAt: session.startedAt,
          runtime: {
            terminalMode: session.runtime.terminalMode,
            ptyAvailable: session.runtime.ptyAvailable,
            warnings: [...session.runtime.warnings],
            effectiveUrl: session.runtime.effectiveUrl,
            port: session.runtime.port,
            readyHintSeen: session.runtime.readyHintSeen,
          },
          exitWasRestartReplace: replacedByRestart,
          exitWasStopRequest: stopRequested,
        });

        // Keep memory bounded.
        if (this.recentLogs.size > MAX_RECENT_LOGS) {
          const oldestKey = this.recentLogs.keys().next().value;
          if (oldestKey) {
            this.recentLogs.delete(oldestKey);
          }
        }
      });

      this.sessions.set(key, session);
      if (typeof launchPort === "number") {
        void this.verifyLocalEffectiveUrl(session);
      }
      return session;
    });
  }

  private requestStop(session: Session) {
    if (!session.stopRequested) {
      this.recordHistory(session.projectId, session.serviceName, "stop_requested", {
        runId: session.runId,
      });
      session.stopRequested = true;
    }

    try {
      session.runner.interrupt();
      setTimeout(() => {
        if (this.sessions.get(session.key) === session) {
          try {
            session.runner.kill();
          } catch {
            // ignore race while exiting
          }
        }
      }, STOP_KILL_TIMEOUT_MS);
    } catch {
      try {
        session.runner.kill();
      } catch {
        // no-op
      }
    }
  }

  stop(projectId: string, serviceName: string) {
    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (!session) {
      return false;
    }

    this.requestStop(session);

    return true;
  }

  async stopAll() {
    const runningSessions = Array.from(this.sessions.values());
    if (!runningSessions.length) {
      return {
        requested: 0,
        stopped: 0,
        remaining: 0,
      };
    }

    const targetKeys = new Set<string>();
    for (const session of runningSessions) {
      targetKeys.add(session.key);
      this.requestStop(session);
    }

    const deadline = Date.now() + STOP_ALL_WAIT_TIMEOUT_MS;
    while (targetKeys.size && Date.now() < deadline) {
      for (const key of [...targetKeys]) {
        if (!this.sessions.has(key)) {
          targetKeys.delete(key);
        }
      }
      if (!targetKeys.size) {
        break;
      }
      await sleep(STOP_ALL_POLL_MS);
    }

    if (targetKeys.size) {
      for (const key of [...targetKeys]) {
        const session = this.sessions.get(key);
        if (!session) {
          targetKeys.delete(key);
          continue;
        }
        try {
          session.runner.kill();
        } catch {
          // ignore race while exiting
        }
      }

      const forcedDeadline = Date.now() + STOP_KILL_TIMEOUT_MS;
      while (targetKeys.size && Date.now() < forcedDeadline) {
        for (const key of [...targetKeys]) {
          if (!this.sessions.has(key)) {
            targetKeys.delete(key);
          }
        }
        if (!targetKeys.size) {
          break;
        }
        await sleep(STOP_ALL_POLL_MS);
      }
    }

    return {
      requested: runningSessions.length,
      stopped: runningSessions.length - targetKeys.size,
      remaining: targetKeys.size,
    };
  }

  async restart(project: RegistryEntry, service: ProjectService) {
    const key = makeKey(project.id, service.name);
    const existing = this.sessions.get(key);
    this.recordHistory(project.id, service.name, "restart_requested", {
      runId: existing?.runId,
    });

    if (existing) {
      this.replacedRunIds.add(existing.runId);
      try {
        existing.runner.kill();
      } catch {
        // ignore kill race
      }
      // Remove the previous session immediately; exit handler is guarded to avoid clobbering.
      this.sessions.delete(key);

      if (typeof existing.launchPort === "number") {
        await waitForPortRelease(existing.launchPort);
      } else if (typeof service.port === "number") {
        await waitForPortRelease(service.port);
      }
    }

    return this.start(project, service);
  }

  writeInput(projectId: string, serviceName: string, input: string) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return false;
    }

    session.runner.write(input);
    this.trackInput(session, input);
    return true;
  }

  resize(projectId: string, serviceName: string, cols: number, rows: number) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return false;
    }

    session.runner.resize(Math.max(20, cols), Math.max(8, rows));
    return true;
  }

  attach(
    projectId: string,
    serviceName: string,
    ws: WebSocket,
    replay = true,
    expectedRunId?: string,
  ) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return { ok: false as const, error: "Process is not running" };
    }

    if (expectedRunId && session.runId !== expectedRunId) {
      return {
        ok: false as const,
        error: `Run mismatch (expected ${expectedRunId}, active ${session.runId})`,
      };
    }

    session.clients.add(ws);
    const ready = this.isSessionReady(session);
    ws.send(
      JSON.stringify({
        type: "meta",
        runId: session.runId,
        startedAt: session.startedAt,
        status: ready ? "ready" : "starting",
        ready,
        mode: session.runtime.terminalMode,
        ptyAvailable: session.runtime.ptyAvailable,
        warnings: session.runtime.warnings,
        effectiveUrl: session.runtime.effectiveUrl,
        port: session.runtime.port,
        requestedPort: session.runtime.requestedPort,
      }),
    );
    if (replay && session.logBuffer) {
      ws.send(JSON.stringify({ type: "output", data: session.logBuffer }));
    }

    return { ok: true as const, runId: session.runId };
  }

  detach(projectId: string, serviceName: string, ws: WebSocket) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return;
    }

    session.clients.delete(ws);
  }

  getRunInfo(projectId: string, serviceName: string): RunInfo {
    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (session) {
      const ready = this.isSessionReady(session);
      return {
        runId: session.runId,
        lastRunId: session.runId,
        running: true,
        status: ready ? "ready" : "starting",
        ready,
        startedAt: session.startedAt,
        terminalMode: session.runtime.terminalMode,
        ptyAvailable: session.runtime.ptyAvailable,
        warnings: [...session.runtime.warnings],
        effectiveUrl: session.runtime.effectiveUrl,
        port: session.runtime.port,
        requestedPort: session.runtime.requestedPort,
        lastExitCode: undefined,
        exitWasRestartReplace: false,
        exitWasStopRequest: false,
      };
    }

    const recent = this.recentLogs.get(key);
    const status = this.getRecentStatus(recent);
    return {
      runId: undefined,
      lastRunId: recent?.runId,
      running: false,
      status,
      ready: false,
      startedAt: recent?.startedAt,
      terminalMode: recent?.runtime.terminalMode,
      ptyAvailable: recent?.runtime.ptyAvailable,
      warnings: recent ? [...recent.runtime.warnings] : [],
      effectiveUrl: recent?.runtime.effectiveUrl,
      port: recent?.runtime.port,
      requestedPort: recent?.runtime.requestedPort,
      lastExitCode: recent?.exitCode,
      exitWasRestartReplace: Boolean(recent?.exitWasRestartReplace),
      exitWasStopRequest: Boolean(recent?.exitWasStopRequest),
    };
  }

  getLogTail(
    projectId: string,
    serviceName: string,
    chars = 6000,
    expectedRunId?: string,
  ) {
    if (chars <= 0) {
      return "";
    }

    const buffer = this.getLogBuffer(projectId, serviceName, expectedRunId);
    if (!buffer) {
      return "";
    }

    return buffer.slice(-chars);
  }

  getLogTailLines(
    projectId: string,
    serviceName: string,
    lines = 100,
    expectedRunId?: string,
  ) {
    if (lines <= 0) {
      return "";
    }

    const buffer = this.getLogBuffer(projectId, serviceName, expectedRunId);
    if (!buffer) {
      return "";
    }

    // Keep line endings intact while taking the newest N lines.
    const chunks = buffer.match(/[^\n]*\n|[^\n]+/g) || [];
    return chunks.slice(-lines).join("");
  }

  private getLogBuffer(
    projectId: string,
    serviceName: string,
    expectedRunId?: string,
  ) {
    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (session) {
      if (expectedRunId && expectedRunId !== session.runId) {
        return "";
      }
      return session.logBuffer;
    }

    const recent = this.recentLogs.get(key);
    if (!recent) {
      return "";
    }
    if (expectedRunId && expectedRunId !== recent.runId) {
      return "";
    }

    return recent.logBuffer;
  }
}
