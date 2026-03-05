import fs from "fs";
import path from "path";
import { readAllProjectConfigs } from "./config";
import { DEVRUN_HOME } from "./storage";

type PortAssignment = {
  projectId: string;
  serviceName: string;
  port: number;
};

type PortAssignmentsFile = {
  assignments?: unknown;
};

export type ReservedPortOwner = {
  projectId: string;
  serviceName: string;
  port: number;
  source: "config" | "assigned";
};

const PORT_ASSIGNMENTS_PATH = path.join(DEVRUN_HOME, "runtime", "port-assignments.json");

function makeServiceKey(projectId: string, serviceName: string) {
  return `${projectId}::${serviceName}`;
}

function ensureAssignmentsDir() {
  fs.mkdirSync(path.dirname(PORT_ASSIGNMENTS_PATH), { recursive: true });
}

function readPortAssignmentsFile(): PortAssignment[] {
  ensureAssignmentsDir();
  if (!fs.existsSync(PORT_ASSIGNMENTS_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(PORT_ASSIGNMENTS_PATH, "utf8");
    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw) as PortAssignmentsFile;
    const assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
    return assignments
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const candidate = entry as Partial<PortAssignment>;
        if (
          typeof candidate.projectId !== "string" ||
          typeof candidate.serviceName !== "string" ||
          typeof candidate.port !== "number" ||
          !Number.isInteger(candidate.port) ||
          candidate.port < 1 ||
          candidate.port > 65535
        ) {
          return null;
        }
        return {
          projectId: candidate.projectId,
          serviceName: candidate.serviceName,
          port: candidate.port,
        };
      })
      .filter((entry): entry is PortAssignment => Boolean(entry));
  } catch {
    return [];
  }
}

function writePortAssignmentsFile(assignments: PortAssignment[]) {
  ensureAssignmentsDir();
  fs.writeFileSync(
    PORT_ASSIGNMENTS_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        assignments,
      },
      null,
      2,
    ),
  );
}

export function prunePortAssignments() {
  const configs = readAllProjectConfigs();
  const validServiceKeys = new Set<string>();
  const explicitPortKeys = new Set<string>();

  for (const [projectId, config] of Object.entries(configs)) {
    for (const service of config.services) {
      const key = makeServiceKey(projectId, service.name);
      validServiceKeys.add(key);
      if (typeof service.port === "number") {
        explicitPortKeys.add(key);
      }
    }
  }

  const current = readPortAssignmentsFile();
  const filtered = current.filter((entry) => {
    const key = makeServiceKey(entry.projectId, entry.serviceName);
    return validServiceKeys.has(key) && !explicitPortKeys.has(key);
  });

  if (filtered.length !== current.length) {
    writePortAssignmentsFile(filtered);
  }

  return filtered;
}

export function getAssignedPort(projectId: string, serviceName: string) {
  const key = makeServiceKey(projectId, serviceName);
  const assignment = prunePortAssignments().find(
    (entry) => makeServiceKey(entry.projectId, entry.serviceName) === key,
  );
  return assignment?.port;
}

export function setAssignedPort(projectId: string, serviceName: string, port: number) {
  const key = makeServiceKey(projectId, serviceName);
  const assignments = prunePortAssignments().filter(
    (entry) => makeServiceKey(entry.projectId, entry.serviceName) !== key,
  );
  assignments.push({ projectId, serviceName, port });
  writePortAssignmentsFile(assignments);
}

export function deleteAssignedPort(projectId: string, serviceName: string) {
  const key = makeServiceKey(projectId, serviceName);
  const current = prunePortAssignments();
  const filtered = current.filter(
    (entry) => makeServiceKey(entry.projectId, entry.serviceName) !== key,
  );
  if (filtered.length !== current.length) {
    writePortAssignmentsFile(filtered);
  }
}

export function listReservedPorts(): ReservedPortOwner[] {
  const configs = readAllProjectConfigs();
  const owners: ReservedPortOwner[] = [];
  const explicitPortKeys = new Set<string>();

  for (const [projectId, config] of Object.entries(configs)) {
    for (const service of config.services) {
      const key = makeServiceKey(projectId, service.name);
      if (typeof service.port === "number") {
        explicitPortKeys.add(key);
        owners.push({
          projectId,
          serviceName: service.name,
          port: service.port,
          source: "config",
        });
      }
    }
  }

  for (const assignment of prunePortAssignments()) {
    const key = makeServiceKey(assignment.projectId, assignment.serviceName);
    if (explicitPortKeys.has(key)) {
      continue;
    }
    owners.push({
      projectId: assignment.projectId,
      serviceName: assignment.serviceName,
      port: assignment.port,
      source: "assigned",
    });
  }

  return owners;
}

export function findReservedPortOwner(
  port: number,
  exclude?: { projectId: string; serviceName: string },
) {
  const excludeKey =
    exclude && exclude.projectId && exclude.serviceName
      ? makeServiceKey(exclude.projectId, exclude.serviceName)
      : "";
  return listReservedPorts().find((owner) => {
    if (owner.port !== port) {
      return false;
    }
    return makeServiceKey(owner.projectId, owner.serviceName) !== excludeKey;
  });
}
