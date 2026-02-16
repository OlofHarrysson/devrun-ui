import path from "path";
import { randomUUID } from "crypto";
import { spawn as spawnChild } from "child_process";
import { spawn as spawnPty } from "node-pty";
import type { WebSocket } from "ws";
import type { ProjectService, RegistryEntry, ServiceStatus } from "./types";
import { ServiceHistoryStore } from "./historyStore";

type ProcessRunner = {
  write: (input: string) => void;
  resize: (cols: number, rows: number) => void;
  interrupt: () => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number) => void) => void;
  mode: "pty" | "pipe";
};

type RuntimeMetadata = {
  terminalMode: "pty" | "pipe";
  ptyAvailable: boolean;
  warnings: string[];
  effectiveUrl?: string;
  port?: number;
  readyHintSeen: boolean;
};

type RunInfo = {
  runId?: string;
  lastRunId?: string;
  running: boolean;
  status: ServiceStatus;
  ready: boolean;
  startedAt?: string;
  terminalMode?: "pty" | "pipe";
  ptyAvailable?: boolean;
  warnings: string[];
  effectiveUrl?: string;
  port?: number;
  lastExitCode?: number;
  exitWasRestartReplace: boolean;
  exitWasStopRequest: boolean;
};

type Session = {
  key: string;
  projectId: string;
  serviceName: string;
  runId: string;
  runner: ProcessRunner;
  startedAt: string;
  logBuffer: string;
  clients: Set<WebSocket>;
  inputBuffer: string;
  runtime: RuntimeMetadata;
  warningKeys: Set<string>;
  detectedUrls: string[];
  stopRequested: boolean;
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

const MAX_LOG_CHARS = 120_000;
const MAX_RECENT_LOGS = 100;
const HISTORY_RETENTION = 100;
const READY_GRACE_MS = 2500;

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
    if (parsed.hostname === "0.0.0.0" || parsed.hostname === "::") {
      parsed.hostname = "localhost";
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

function parseWarningLines(chunk: string) {
  const warnings: string[] = [];
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (
      /(EADDRINUSE|address already in use|port\s+\d+.*(in use|already)|trying\s+\d+|pty unavailable)/i.test(
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

function buildChildEnv() {
  const env = { ...process.env };
  // Avoid inheriting server port into child apps (can collide with Devrun itself).
  delete env.PORT;
  return env as Record<string, string>;
}

function signalProcessTree(
  child: ReturnType<typeof spawnChild>,
  signal: NodeJS.Signals,
) {
  // In pipe mode, we need to terminate the whole process tree (e.g. tsx watch + node child).
  // On Unix we create a detached process group and signal the group by negative pid.
  if (process.platform !== "win32" && typeof child.pid === "number" && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // fallback to direct child signal
    }
  }

  try {
    child.kill(signal);
  } catch {
    // no-op
  }
}

function createPtyRunner(
  shell: string,
  command: string,
  cwd: string,
): ProcessRunner {
  const pty = spawnPty(shell, ["-lc", command], {
    name: "xterm-color",
    cols: 120,
    rows: 32,
    cwd,
    env: buildChildEnv(),
  });

  return {
    write(input) {
      pty.write(input);
    },
    resize(cols, rows) {
      pty.resize(Math.max(20, cols), Math.max(8, rows));
    },
    interrupt() {
      pty.write("\u0003");
    },
    kill() {
      pty.kill();
    },
    onData(listener) {
      pty.onData(listener);
    },
    onExit(listener) {
      pty.onExit(({ exitCode }) => listener(exitCode));
    },
    mode: "pty",
  };
}

function createPipeRunner(
  shell: string,
  command: string,
  cwd: string,
): ProcessRunner {
  const child = spawnChild(shell, ["-lc", command], {
    cwd,
    env: buildChildEnv(),
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
      signalProcessTree(child, "SIGINT");
    },
    kill() {
      signalProcessTree(child, "SIGKILL");
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
  };
}

export class ProcessManager {
  private sessions = new Map<string, Session>();
  private recentLogs = new Map<string, RecentLog>();
  private replacedRunIds = new Set<string>();
  private history = new ServiceHistoryStore({ retention: HISTORY_RETENTION });

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

  private recordHistory(
    projectId: string,
    serviceName: string,
    type: "start" | "stop_requested" | "restart_requested" | "stdin_command" | "exit",
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

    const effectiveUrl = chooseEffectiveUrl(session.detectedUrls);
    session.runtime.effectiveUrl = effectiveUrl;
    if (effectiveUrl) {
      try {
        const parsed = new URL(effectiveUrl);
        session.runtime.port = parsed.port ? Number(parsed.port) : undefined;
      } catch {
        session.runtime.port = undefined;
      }
    } else {
      session.runtime.port = undefined;
    }

    if (!session.runtime.readyHintSeen && (Boolean(effectiveUrl) || hasReadySignal(chunk))) {
      session.runtime.readyHintSeen = true;
    }

    const warningLines = parseWarningLines(chunk);
    for (const warning of warningLines) {
      const key = warning.toLowerCase();
      if (session.warningKeys.has(key)) {
        continue;
      }
      session.warningKeys.add(key);
      session.runtime.warnings.push(warning);
      if (session.runtime.warnings.length > 12) {
        session.runtime.warnings = session.runtime.warnings.slice(-12);
      }
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

  start(project: RegistryEntry, service: ProjectService): Session {
    const key = makeKey(project.id, service.name);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }
    this.recentLogs.delete(key);

    const shell = process.env.SHELL || "/bin/zsh";
    const cwd = service.cwd
      ? path.resolve(project.root, service.cwd)
      : project.root;

    let runner: ProcessRunner;
    let modeNotice = "";
    let ptyWarning = "";
    try {
      runner = createPtyRunner(shell, service.cmd, cwd);
    } catch (error) {
      runner = createPipeRunner(shell, service.cmd, cwd);
      const reason =
        error instanceof Error ? error.message : "Failed to initialize PTY";
      ptyWarning = `PTY unavailable, using pipe mode: ${reason}`;
      modeNotice = marker(`[${ptyWarning}]`);
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const session: Session = {
      key,
      projectId: project.id,
      serviceName: service.name,
      runId,
      runner,
      startedAt,
      logBuffer: `${marker(`[run ${runId}]`, startedAt)}${marker(`$ ${service.cmd}`, startedAt)}${modeNotice}`,
      clients: new Set<WebSocket>(),
      inputBuffer: "",
      runtime: {
        terminalMode: runner.mode,
        ptyAvailable: runner.mode === "pty",
        warnings: ptyWarning ? [ptyWarning] : [],
        readyHintSeen: false,
      },
      warningKeys: new Set<string>(ptyWarning ? [ptyWarning.toLowerCase()] : []),
      detectedUrls: [],
      stopRequested: false,
    };

    this.recordHistory(project.id, service.name, "start", {
      runId,
      data: {
        cmd: service.cmd,
        cwd: service.cwd || ".",
        mode: runner.mode,
        ptyAvailable: runner.mode === "pty",
      },
    });

    runner.onData((data) => {
      this.appendLog(session, data);
      this.updateRuntimeMetadata(session, data);

      for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: "output", data }));
        }
      }
    });

    runner.onExit((exitCode) => {
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
    return session;
  }

  stop(projectId: string, serviceName: string) {
    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (!session) {
      return false;
    }

    this.recordHistory(projectId, serviceName, "stop_requested", {
      runId: session.runId,
    });
    session.stopRequested = true;

    try {
      session.runner.interrupt();
      setTimeout(() => {
        if (this.sessions.has(key)) {
          try {
            session.runner.kill();
          } catch {
            // ignore race while exiting
          }
        }
      }, 1200);
    } catch {
      try {
        session.runner.kill();
      } catch {
        // no-op
      }
    }

    return true;
  }

  restart(project: RegistryEntry, service: ProjectService) {
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

    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (session) {
      if (expectedRunId && expectedRunId !== session.runId) {
        return "";
      }
      return session.logBuffer.slice(-chars);
    }

    const recent = this.recentLogs.get(key);
    if (!recent) {
      return "";
    }
    if (expectedRunId && expectedRunId !== recent.runId) {
      return "";
    }

    return recent.logBuffer.slice(-chars);
  }
}
