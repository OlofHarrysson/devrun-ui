import path from "path";
import { randomUUID } from "crypto";
import { spawn as spawnChild } from "child_process";
import { spawn as spawnPty } from "node-pty";
import type { WebSocket } from "ws";
import type { ProjectService, RegistryEntry } from "./types";

type ProcessRunner = {
  write: (input: string) => void;
  resize: (cols: number, rows: number) => void;
  interrupt: () => void;
  kill: () => void;
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (exitCode: number) => void) => void;
  mode: "pty" | "pipe";
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
};

type RecentLog = {
  runId: string;
  logBuffer: string;
  exitCode: number;
  exitedAt: string;
};

const MAX_LOG_CHARS = 120_000;
const MAX_RECENT_LOGS = 100;

function makeKey(projectId: string, serviceName: string) {
  return `${projectId}::${serviceName}`;
}

function buildChildEnv() {
  const env = { ...process.env };
  // Avoid inheriting server port into child apps (can collide with Devrun itself).
  delete env.PORT;
  return env as Record<string, string>;
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
  });

  return {
    write(input) {
      child.stdin?.write(input);
    },
    resize() {
      // Not supported in pipe mode.
    },
    interrupt() {
      child.kill("SIGINT");
    },
    kill() {
      child.kill("SIGKILL");
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

  isRunning(projectId: string, serviceName: string) {
    return this.sessions.has(makeKey(projectId, serviceName));
  }

  listRunning() {
    return Array.from(this.sessions.values()).map((session) => ({
      projectId: session.projectId,
      serviceName: session.serviceName,
      startedAt: session.startedAt,
      runId: session.runId,
    }));
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
    try {
      runner = createPtyRunner(shell, service.cmd, cwd);
    } catch (error) {
      runner = createPipeRunner(shell, service.cmd, cwd);
      const reason =
        error instanceof Error ? error.message : "Failed to initialize PTY";
      modeNotice = `\r\n[pty unavailable, using pipe mode: ${reason}]\r\n`;
    }

    const runId = randomUUID();
    const session: Session = {
      key,
      projectId: project.id,
      serviceName: service.name,
      runId,
      runner,
      startedAt: new Date().toISOString(),
      logBuffer: `\r\n[run ${runId}]\r\n$ ${service.cmd}\r\n${modeNotice}`,
      clients: new Set<WebSocket>(),
    };

    runner.onData((data) => {
      session.logBuffer = `${session.logBuffer}${data}`;
      if (session.logBuffer.length > MAX_LOG_CHARS) {
        session.logBuffer = session.logBuffer.slice(
          session.logBuffer.length - MAX_LOG_CHARS,
        );
      }

      for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: "output", data }));
        }
      }
    });

    runner.onExit((exitCode) => {
      const msg = `\r\n[process exited ${exitCode}]\r\n`;
      session.logBuffer = `${session.logBuffer}${msg}`;

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

    if (existing) {
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
    ws.send(
      JSON.stringify({
        type: "meta",
        runId: session.runId,
        startedAt: session.startedAt,
        mode: session.runner.mode,
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

  getRunInfo(projectId: string, serviceName: string) {
    const key = makeKey(projectId, serviceName);
    const session = this.sessions.get(key);
    if (session) {
      return {
        runId: session.runId,
        lastRunId: session.runId,
        running: true,
      };
    }

    const recent = this.recentLogs.get(key);
    return {
      runId: undefined,
      lastRunId: recent?.runId,
      running: false,
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
