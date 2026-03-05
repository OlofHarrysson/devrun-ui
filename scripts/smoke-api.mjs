#!/usr/bin/env node

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function tail(text, maxChars = 4000) {
  if (!text) {
    return "";
  }
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}

async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeDevPackage(projectRoot, name = "devrun-smoke-app") {
  const packageJsonPath = path.join(projectRoot, "package.json");
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name,
        private: true,
        scripts: {
          dev:
            "node -e \"const http=require('http'); const port=Number(process.env.PORT||4567); " +
            "const server=http.createServer((_req,res)=>{res.writeHead(200, {'content-type':'text/plain'}); res.end('ok');}); " +
            "server.listen(port, '0.0.0.0', ()=>console.log('Local: http://localhost:'+port)); " +
            "setInterval(() => console.log('tick'), 250);\"",
        },
      },
      null,
      2,
    ),
  );
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${init?.method || "GET"} ${url}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function requestWithStatus(url, init) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { status: response.status, body };
}

async function waitForServerReady(baseUrl, logsRef, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/state`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry.
    }
    await sleep(250);
  }

  throw new Error(
    `Server did not become ready at ${baseUrl} within ${timeoutMs}ms.\nServer logs:\n${tail(logsRef.value)}`,
  );
}

async function waitForProjectService(baseUrl, projectRoot, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await requestJson(`${baseUrl}/api/state`);
    const project = Array.isArray(state.projects)
      ? state.projects.find((entry) => entry.root === projectRoot)
      : null;
    const service =
      project && Array.isArray(project.services) && project.defaultService
        ? project.services.find((entry) => entry.name === project.defaultService) ||
          project.services[0]
        : project && Array.isArray(project.services)
          ? project.services[0]
          : null;

    if (project && service && predicate(project, service)) {
      return { project, service };
    }
    await sleep(300);
  }

  throw new Error(`Timed out waiting for project/service state for ${projectRoot}`);
}

async function openWebSocket(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let done = false;

    const finish = (cb, value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      cb(value);
    };

    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // no-op
      }
      finish(reject, new Error(`Timed out opening WebSocket: ${url}`));
    }, timeoutMs);

    ws.once("open", () => {
      finish(resolve, ws);
    });
    ws.once("error", (error) => {
      finish(
        reject,
        error instanceof Error ? error : new Error(`WebSocket error: ${String(error)}`),
      );
    });
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(2000).then(() => false),
  ]);

  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", () => resolve(true))),
      sleep(1500),
    ]);
  }
}

async function main() {
  const logsRef = { value: "" };
  let serverProcess;
  let tempProjectRoot = "";
  let tempProjectRootB = "";
  let createdProjectId = "";

  try {
    const port = await pickFreePort();
    const baseUrl = `http://localhost:${port}`;

    serverProcess = spawn("node", ["dist/server.js"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout?.on("data", (chunk) => {
      logsRef.value += chunk.toString();
    });
    serverProcess.stderr?.on("data", (chunk) => {
      logsRef.value += chunk.toString();
    });

    await waitForServerReady(baseUrl, logsRef);

    tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devrun-smoke-"));
    writeDevPackage(tempProjectRoot);

    const started = await requestJson(`${baseUrl}/api/process/start`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });

    assert(started.ok === true, "Expected /api/process/start to return ok=true");
    assert(started.action === "start", "Expected start action response");
    assert(
      started.process && started.process.projectPath === tempProjectRoot,
      "Expected process.projectPath in start response",
    );
    assert(
      typeof started.process?.serviceName === "string" && started.process.serviceName.length > 0,
      "Expected process.serviceName in start response",
    );
    assert(
      started.process?.usedDefaultService === true,
      "Expected usedDefaultService=true when serviceName is omitted",
    );
    assert(
      typeof started.process?.runId === "string" && started.process.runId.length > 0,
      "Expected runId in start response",
    );
    assert(started.process?.terminalMode === "pipe", "Expected terminalMode to be pipe");
    assert(started.process?.ptyAvailable === false, "Expected ptyAvailable=false in start response");
    assert(
      started.process?.status === "starting" || started.process?.status === "ready",
      "Expected status in start response",
    );
    assert(
      typeof started.process?.ready === "boolean",
      "Expected ready boolean in start response",
    );

    const { project, service } = await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === true &&
        candidateService.ready === true &&
        typeof candidateService.port === "number" &&
        typeof candidateService.effectiveUrl === "string",
    );

    assert(
      typeof project.defaultService === "string" && project.defaultService.length > 0,
      "Expected defaultService in /api/state",
    );
    createdProjectId = project.id;
    assert(
      service.runId === started.process.runId,
      "Expected /api/state runId to match /api/process/start",
    );
    assert(Array.isArray(service.warnings), "Expected warnings array in /api/state");
    assert(service.status === "ready", "Expected ready status in /api/state");
    assert(service.ready === true, "Expected ready=true in /api/state");
    assert(service.terminalMode === "pipe", "Expected terminalMode=pipe in /api/state");
    assert(typeof service.port === "number", "Expected auto-assigned port in /api/state");
    assert(
      typeof service.effectiveUrl === "string",
      "Expected verified effectiveUrl in /api/state",
    );
    assert(
      !service.effectiveUrl.includes("localhost"),
      "Expected effectiveUrl to use a numeric loopback host",
    );
    const autoAssignedPortA = service.port;

    const history = await requestJson(
      `${baseUrl}/api/history?projectPath=${encodeURIComponent(tempProjectRoot)}`,
    );
    assert(history.projectPath === tempProjectRoot, "Expected projectPath in /api/history");
    assert(
      history.serviceName === started.process.serviceName,
      "Expected serviceName in /api/history",
    );
    assert(Array.isArray(history.events), "Expected events array in /api/history");

    const logs = await requestJson(
      `${baseUrl}/api/logs?projectPath=${encodeURIComponent(tempProjectRoot)}&chars=4000`,
    );
    assert(logs.projectPath === tempProjectRoot, "Expected projectPath in /api/logs");
    assert(logs.serviceName === started.process.serviceName, "Expected serviceName in /api/logs");
    assert(typeof logs.output === "string", "Expected output string in /api/logs");
    assert(logs.output.includes("$ npm run dev"), "Expected command marker in /api/logs output");

    const logsByLines = await requestJson(
      `${baseUrl}/api/logs?projectPath=${encodeURIComponent(tempProjectRoot)}&lines=500`,
    );
    assert(logsByLines.lines === 500, "Expected lines=500 echo in /api/logs response");
    assert(typeof logsByLines.output === "string", "Expected output string for line-based /api/logs");
    assert(
      logsByLines.output.includes("$ npm run dev"),
      "Expected command marker in line-based /api/logs output",
    );

    const wsBaseUrl = baseUrl.replace(/^http/, "ws");
    const clientLogWsUrl =
      `${wsBaseUrl}/ws/client-logs?projectId=${encodeURIComponent(project.id)}` +
      `&serviceName=${encodeURIComponent(service.name)}` +
      `&runId=${encodeURIComponent(started.process.runId)}`;
    const clientLogWs = await openWebSocket(clientLogWsUrl);
    clientLogWs.send(
      JSON.stringify({
        type: "client_log_batch",
        entries: [
          {
            level: "warn",
            ts: new Date().toISOString(),
            message: "smoke warn bridge",
            path: "/smoke",
            source: "console",
            clientId: "smoke-client",
          },
          {
            level: "debug",
            ts: new Date().toISOString(),
            message: "smoke debug bridge",
            path: "/smoke",
            source: "console",
            clientId: "smoke-client",
          },
        ],
      }),
    );
    await sleep(150);
    try {
      clientLogWs.close();
    } catch {
      // no-op
    }

    const logsAfterClientBridge = await requestJson(
      `${baseUrl}/api/logs?projectPath=${encodeURIComponent(tempProjectRoot)}&chars=6000`,
    );
    assert(
      logsAfterClientBridge.output.includes("[browser:warn] /smoke smoke warn bridge"),
      "Expected warn browser log in /api/logs output",
    );
    assert(
      logsAfterClientBridge.output.includes("[browser:debug] /smoke smoke debug bridge"),
      "Expected debug browser log in /api/logs output",
    );

    const historyAfterClientBridge = await requestJson(
      `${baseUrl}/api/history?projectPath=${encodeURIComponent(tempProjectRoot)}&limit=50`,
    );
    assert(
      historyAfterClientBridge.events.some(
        (event) => event.type === "client_log" && event.data?.level === "warn",
      ),
      "Expected warn client_log event in /api/history",
    );
    assert(
      historyAfterClientBridge.events.some(
        (event) => event.type === "client_log" && event.data?.level === "debug",
      ),
      "Expected debug client_log event in /api/history",
    );

    await requestJson(`${baseUrl}/api/process/stop`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });

    await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === false && candidateService.status === "stopped",
    );

    tempProjectRootB = fs.mkdtempSync(path.join(os.tmpdir(), "devrun-smoke-b-"));
    writeDevPackage(tempProjectRootB, "devrun-smoke-app-b");

    const startedB = await requestJson(`${baseUrl}/api/process/start`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRootB }),
    });
    assert(startedB.ok === true, "Expected second auto-assigned service to start");

    const { service: serviceB } = await waitForProjectService(
      baseUrl,
      tempProjectRootB,
      (_project, candidateService) =>
        candidateService.running === true &&
        candidateService.ready === true &&
        typeof candidateService.port === "number" &&
        typeof candidateService.effectiveUrl === "string",
    );
    assert(
      typeof serviceB.port === "number" && serviceB.port !== autoAssignedPortA,
      "Expected second auto-assigned service to get a different reserved port",
    );
    assert(
      typeof serviceB.effectiveUrl === "string" && !serviceB.effectiveUrl.includes("localhost"),
      "Expected second service effectiveUrl to use a numeric loopback host",
    );

    await requestJson(`${baseUrl}/api/process/start`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });
    const { service: serviceAAfterRestart } = await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === true &&
        candidateService.ready === true &&
        candidateService.port === autoAssignedPortA &&
        typeof candidateService.effectiveUrl === "string",
    );
    assert(
      serviceAAfterRestart.port === autoAssignedPortA,
      "Expected first service to keep its reserved auto-assigned port after restart",
    );
    assert(
      typeof serviceAAfterRestart.effectiveUrl === "string" &&
        !serviceAAfterRestart.effectiveUrl.includes("localhost"),
      "Expected restarted service effectiveUrl to use a numeric loopback host",
    );

    await requestJson(`${baseUrl}/api/process/stop`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });
    await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === false && candidateService.status === "stopped",
    );

    await requestJson(`${baseUrl}/api/process/stop`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRootB }),
    });
    await waitForProjectService(
      baseUrl,
      tempProjectRootB,
      (_project, candidateService) =>
        candidateService.running === false && candidateService.status === "stopped",
    );

    const configuredPort = await pickFreePort();
    await requestJson(`${baseUrl}/api/project-config`, {
      method: "POST",
      body: JSON.stringify({
        projectId: createdProjectId,
        services: [
          {
            name: service.name,
            cmd: "npm run dev",
            port: configuredPort,
          },
        ],
      }),
    });

    const configuredStart = await requestJson(`${baseUrl}/api/process/start`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });
    assert(
      configuredStart.process?.port === configuredPort,
      "Expected configured port in start response when service port is set",
    );

    await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === true &&
        candidateService.ready === true &&
        candidateService.port === configuredPort,
    );

    await requestJson(`${baseUrl}/api/process/stop`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });
    await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) =>
        candidateService.running === false && candidateService.status === "stopped",
    );

    const conflictPort = await pickFreePort();
    const occupied = net.createServer();
    occupied.unref();
    await new Promise((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(conflictPort, "127.0.0.1", () => resolve(undefined));
    });
    try {
      await requestJson(`${baseUrl}/api/project-config`, {
        method: "POST",
        body: JSON.stringify({
          projectId: createdProjectId,
          services: [
            {
              name: service.name,
              cmd: "npm run dev",
              port: conflictPort,
            },
          ],
        }),
      });

      const conflictStart = await requestWithStatus(`${baseUrl}/api/process/start`, {
        method: "POST",
        body: JSON.stringify({ projectPath: tempProjectRoot }),
      });
      assert(conflictStart.status === 409, "Expected 409 when configured port is already in use");
      assert(
        typeof conflictStart.body?.error === "string" &&
          conflictStart.body.error.toLowerCase().includes("configured port"),
        "Expected configured port conflict message in start error response",
      );
    } finally {
      await new Promise((resolve) => {
        occupied.close(() => {
          resolve(undefined);
        });
      });
    }

    const ipv6ConflictPort = await pickFreePort();
    const ipv6Occupied = net.createServer();
    ipv6Occupied.unref();
    let ipv6Supported = true;
    try {
      await new Promise((resolve, reject) => {
        ipv6Occupied.once("error", reject);
        ipv6Occupied.listen(ipv6ConflictPort, "::1", () => resolve(undefined));
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
        ipv6Supported = false;
      } else {
        throw error;
      }
    }
    if (ipv6Supported) {
      try {
        await requestJson(`${baseUrl}/api/project-config`, {
          method: "POST",
          body: JSON.stringify({
            projectId: createdProjectId,
            services: [
              {
                name: service.name,
                cmd: "npm run dev",
                port: ipv6ConflictPort,
              },
            ],
          }),
        });

        const conflictStartIpv6 = await requestWithStatus(`${baseUrl}/api/process/start`, {
          method: "POST",
          body: JSON.stringify({ projectPath: tempProjectRoot }),
        });
        assert(
          conflictStartIpv6.status === 409,
          "Expected 409 when configured port is already in use on ::1",
        );
        assert(
          typeof conflictStartIpv6.body?.error === "string" &&
            conflictStartIpv6.body.error.toLowerCase().includes("configured port"),
          "Expected configured port conflict message for ::1 listener",
        );
      } finally {
        await new Promise((resolve) => {
          ipv6Occupied.close(() => {
            resolve(undefined);
          });
        });
      }
    }

    const cleanup = await requestJson(`${baseUrl}/api/process/cleanup-orphans`, {
      method: "POST",
    });
    assert(cleanup.ok === true, "Expected cleanup-orphans endpoint to return ok=true");
    assert(
      cleanup.report && typeof cleanup.report.inspected === "number",
      "Expected cleanup-orphans report payload",
    );

    const state = await requestJson(`${baseUrl}/api/state`);
    const createdProject = Array.isArray(state.projects)
      ? state.projects.find((entry) => entry.root === tempProjectRoot)
      : null;
    if (createdProject?.id) {
      const response = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(createdProject.id)}`,
        { method: "DELETE" },
      );
      if (response.status !== 204) {
        const text = await response.text();
        throw new Error(
          `Failed to cleanup smoke project (${response.status}): ${text || "no body"}`,
        );
      }
    }
    const createdProjectB = Array.isArray(state.projects)
      ? state.projects.find((entry) => entry.root === tempProjectRootB)
      : null;
    if (createdProjectB?.id) {
      const response = await fetch(
        `${baseUrl}/api/projects/${encodeURIComponent(createdProjectB.id)}`,
        { method: "DELETE" },
      );
      if (response.status !== 204) {
        const text = await response.text();
        throw new Error(
          `Failed to cleanup second smoke project (${response.status}): ${text || "no body"}`,
        );
      }
    }

    console.log(`[smoke:api] PASS (${baseUrl})`);
  } catch (error) {
    console.error(
      `[smoke:api] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (logsRef.value) {
      console.error("[smoke:api] server logs tail:");
      console.error(tail(logsRef.value));
    }
    process.exitCode = 1;
  } finally {
    if (tempProjectRoot) {
      try {
        fs.rmSync(tempProjectRoot, { recursive: true, force: true });
      } catch {
        // no-op
      }
    }
    if (tempProjectRootB) {
      try {
        fs.rmSync(tempProjectRootB, { recursive: true, force: true });
      } catch {
        // no-op
      }
    }
    await stopServer(serverProcess);
  }
}

main();
