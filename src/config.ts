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

function sanitizeConfig(config: Partial<ProjectConfig>): ProjectConfig {
  const servicesInput = Array.isArray(config.services) ? config.services : [];
  const services = servicesInput
    .filter((service) => Boolean(service?.name && service?.cmd))
    .map((service) => ({
      name: service.name.trim(),
      cmd: service.cmd.trim(),
      cwd: service.cwd?.trim() || undefined,
    }));

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
