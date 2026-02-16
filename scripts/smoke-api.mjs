#!/usr/bin/env node

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

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

  try {
    const port = await pickFreePort();
    const baseUrl = `http://localhost:${port}`;

    serverProcess = spawn("node", ["dist/server.js"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
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
    const packageJsonPath = path.join(tempProjectRoot, "package.json");
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "devrun-smoke-app",
          private: true,
          scripts: {
            dev: "node -e \"console.log('Local: http://localhost:4567'); setInterval(() => console.log('tick'), 250);\"",
          },
        },
        null,
        2,
      ),
    );

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
    assert(
      started.process?.terminalMode === "pty" || started.process?.terminalMode === "pipe",
      "Expected terminalMode to be pty or pipe",
    );
    assert(
      typeof started.process?.ptyAvailable === "boolean",
      "Expected ptyAvailable boolean in start response",
    );

    const { project, service } = await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) => candidateService.running === true,
    );

    assert(
      typeof project.defaultService === "string" && project.defaultService.length > 0,
      "Expected defaultService in /api/state",
    );
    assert(
      service.runId === started.process.runId,
      "Expected /api/state runId to match /api/process/start",
    );
    assert(Array.isArray(service.warnings), "Expected warnings array in /api/state");
    assert(
      service.terminalMode === "pty" || service.terminalMode === "pipe",
      "Expected terminalMode in /api/state",
    );

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

    await requestJson(`${baseUrl}/api/process/stop`, {
      method: "POST",
      body: JSON.stringify({ projectPath: tempProjectRoot }),
    });

    await waitForProjectService(
      baseUrl,
      tempProjectRoot,
      (_project, candidateService) => candidateService.running === false,
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
    await stopServer(serverProcess);
  }
}

main();
