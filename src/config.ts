import fs from "fs";
import path from "path";
import YAML from "yaml";
import type { ProjectConfig } from "./types";

export const PROJECT_CONFIG_FILE = ".devrun.yml";

export function getProjectConfigPath(root: string) {
  return path.join(root, PROJECT_CONFIG_FILE);
}

export function readProjectConfig(root: string): ProjectConfig {
  const configPath = getProjectConfigPath(root);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${PROJECT_CONFIG_FILE}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(raw) as ProjectConfig;

  if (!parsed || !Array.isArray(parsed.services)) {
    throw new Error(`${PROJECT_CONFIG_FILE} must include a services array`);
  }

  const sanitizedServices = parsed.services
    .filter((service) => Boolean(service?.name && service?.cmd))
    .map((service) => ({
      name: service.name.trim(),
      cmd: service.cmd.trim(),
      cwd: service.cwd?.trim() || undefined,
    }));

  if (!sanitizedServices.length) {
    throw new Error(`${PROJECT_CONFIG_FILE} has no valid services`);
  }

  return {
    name: parsed.name?.trim() || undefined,
    services: sanitizedServices,
  };
}
