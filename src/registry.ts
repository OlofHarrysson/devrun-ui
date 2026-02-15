import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { RegistryEntry } from "./types";
import { DEVRUN_HOME } from "./storage";

type RegistryFile = {
  projects: RegistryEntry[];
};

const REGISTRY_PATH = path.join(DEVRUN_HOME, "projects.json");

function ensureRegistryDir() {
  fs.mkdirSync(DEVRUN_HOME, { recursive: true });
}

export function getRegistryPath() {
  return REGISTRY_PATH;
}

export function readRegistry(): RegistryEntry[] {
  ensureRegistryDir();
  if (!fs.existsSync(REGISTRY_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as RegistryFile;
  if (!parsed.projects || !Array.isArray(parsed.projects)) {
    return [];
  }

  return parsed.projects;
}

export function writeRegistry(projects: RegistryEntry[]) {
  ensureRegistryDir();
  const payload: RegistryFile = { projects };
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(payload, null, 2));
}

export function addProject(root: string, name?: string): RegistryEntry {
  const projects = readRegistry();
  const normalizedRoot = path.resolve(root);
  const existing = projects.find((p) => p.root === normalizedRoot);
  if (existing) {
    return existing;
  }

  const entry: RegistryEntry = {
    id: randomUUID(),
    name: name && name.trim() ? name.trim() : path.basename(normalizedRoot),
    root: normalizedRoot,
    createdAt: new Date().toISOString(),
  };

  projects.push(entry);
  writeRegistry(projects);
  return entry;
}

export function removeProject(projectId: string) {
  const projects = readRegistry().filter((p) => p.id !== projectId);
  writeRegistry(projects);
}
