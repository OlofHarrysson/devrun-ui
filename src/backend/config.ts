import fs from "fs";
import path from "path";
import type { ProjectConfig } from "./types";
import { DEVRUN_HOME } from "./storage";

type ConfigFile = {
  projects: Record<string, ProjectConfig>;
};

const CONFIG_PATH = path.join(DEVRUN_HOME, "project-configs.json");

function ensureConfigDir() {
  fs.mkdirSync(DEVRUN_HOME, { recursive: true });
}

export function getProjectConfigPath() {
  return CONFIG_PATH;
}

function readConfigFile(): ConfigFile {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return { projects: {} };
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  if (!raw.trim()) {
    return { projects: {} };
  }

  const parsed = JSON.parse(raw) as Partial<ConfigFile>;
  if (!parsed.projects || typeof parsed.projects !== "object") {
    return { projects: {} };
  }

  return { projects: parsed.projects };
}

function writeConfigFile(file: ConfigFile) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2));
}

function parseServicePort(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }

  const value =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number(input.trim())
        : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("Service port must be an integer between 1 and 65535");
  }

  return value;
}

function inferPortFromCommand(command: string): number | undefined {
  const match = command.match(/^\s*PORT=(\d+)\s+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }

  return parsed;
}

function sanitizeConfig(config: Partial<ProjectConfig>): ProjectConfig {
  const servicesInput = Array.isArray(config.services) ? config.services : [];
  const services = servicesInput
    .filter((service) => Boolean(service?.name && service?.cmd))
    .map((service) => {
      const name = service.name.trim();
      const cmd = service.cmd.trim();
      const explicitPort = parseServicePort(service.port);
      const inferredPort = inferPortFromCommand(cmd);
      if (
        typeof explicitPort === "number" &&
        typeof inferredPort === "number" &&
        explicitPort !== inferredPort
      ) {
        throw new Error(
          `Service '${name}' has port=${explicitPort} but command sets PORT=${inferredPort}. Use one port source.`,
        );
      }
      return {
        name,
        cmd,
        cwd: service.cwd?.trim() || undefined,
        port: explicitPort ?? inferredPort,
      };
    });

  if (!services.length) {
    throw new Error("Project config must include at least one valid service");
  }

  const seen = new Set<string>();
  for (const service of services) {
    const key = service.name.toLowerCase();
    if (seen.has(key)) {
      throw new Error("Service names must be unique within a project");
    }
    seen.add(key);
  }

  const requestedDefault =
    typeof config.defaultService === "string" ? config.defaultService.trim() : "";
  let defaultService = services[0].name;
  if (requestedDefault) {
    const matched =
      services.find((service) => service.name === requestedDefault)?.name ||
      services.find(
        (service) => service.name.toLowerCase() === requestedDefault.toLowerCase(),
      )?.name;
    if (!matched) {
      throw new Error(
        `Default service '${requestedDefault}' does not match any configured service name`,
      );
    }
    defaultService = matched;
  }

  return {
    name: config.name?.trim() || undefined,
    defaultService,
    services,
  };
}

export function readProjectConfig(projectId: string): ProjectConfig {
  const file = readConfigFile();
  const config = file.projects[projectId];
  if (!config) {
    throw new Error("Project has no saved services yet. Click Configure to add them.");
  }

  return sanitizeConfig(config);
}

export function writeProjectConfig(projectId: string, config: Partial<ProjectConfig>) {
  const file = readConfigFile();
  file.projects[projectId] = sanitizeConfig(config);
  writeConfigFile(file);
}

export function removeProjectConfig(projectId: string) {
  const file = readConfigFile();
  if (!file.projects[projectId]) {
    return;
  }

  delete file.projects[projectId];
  writeConfigFile(file);
}
