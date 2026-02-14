import path from "path";
import { spawn, type IPty } from "node-pty";
import type { WebSocket } from "ws";
import type { ProjectService, RegistryEntry } from "./types";

type Session = {
  key: string;
  projectId: string;
  serviceName: string;
  pty: IPty;
  startedAt: string;
  logBuffer: string;
  clients: Set<WebSocket>;
};

const MAX_LOG_CHARS = 120_000;

function makeKey(projectId: string, serviceName: string) {
  return `${projectId}::${serviceName}`;
}

export class ProcessManager {
  private sessions = new Map<string, Session>();

  isRunning(projectId: string, serviceName: string) {
    return this.sessions.has(makeKey(projectId, serviceName));
  }

  listRunning() {
    return Array.from(this.sessions.values()).map((session) => ({
      projectId: session.projectId,
      serviceName: session.serviceName,
      startedAt: session.startedAt,
    }));
  }

  start(project: RegistryEntry, service: ProjectService): Session {
    const key = makeKey(project.id, service.name);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const cwd = service.cwd
      ? path.resolve(project.root, service.cwd)
      : project.root;

    const pty = spawn(shell, ["-lc", service.cmd], {
      name: "xterm-color",
      cols: 120,
      rows: 32,
      cwd,
      env: process.env as Record<string, string>,
    });

    const session: Session = {
      key,
      projectId: project.id,
      serviceName: service.name,
      pty,
      startedAt: new Date().toISOString(),
      logBuffer: `\r\n$ ${service.cmd}\r\n`,
      clients: new Set<WebSocket>(),
    };

    pty.onData((data) => {
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

    pty.onExit(({ exitCode }) => {
      const msg = `\r\n[process exited ${exitCode}]\r\n`;
      session.logBuffer = `${session.logBuffer}${msg}`;

      for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: "output", data: msg }));
          client.send(JSON.stringify({ type: "exited", exitCode }));
        }
      }

      this.sessions.delete(key);
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
      session.pty.write("\u0003");
      setTimeout(() => {
        if (this.sessions.has(key)) {
          try {
            session.pty.kill();
          } catch {
            // ignore race while exiting
          }
        }
      }, 1200);
    } catch {
      try {
        session.pty.kill();
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
        existing.pty.kill();
      } catch {
        // ignore kill race
      }
      this.sessions.delete(key);
    }

    return this.start(project, service);
  }

  writeInput(projectId: string, serviceName: string, input: string) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return false;
    }

    session.pty.write(input);
    return true;
  }

  resize(projectId: string, serviceName: string, cols: number, rows: number) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return false;
    }

    session.pty.resize(Math.max(20, cols), Math.max(8, rows));
    return true;
  }

  attach(projectId: string, serviceName: string, ws: WebSocket) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return false;
    }

    session.clients.add(ws);
    if (session.logBuffer) {
      ws.send(JSON.stringify({ type: "output", data: session.logBuffer }));
    }

    return true;
  }

  detach(projectId: string, serviceName: string, ws: WebSocket) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return;
    }

    session.clients.delete(ws);
  }

  getLogTail(projectId: string, serviceName: string, chars = 6000) {
    const session = this.sessions.get(makeKey(projectId, serviceName));
    if (!session) {
      return "";
    }

    if (chars <= 0) {
      return "";
    }

    return session.logBuffer.slice(-chars);
  }
}
