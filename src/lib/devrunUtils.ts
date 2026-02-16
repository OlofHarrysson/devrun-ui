import type {
  ConnectionState,
  HistoryEvent,
  ProjectServiceState,
  ProjectState,
  ServiceLifecycleStatus,
} from "../types/ui";

export const stateLabelByKey: Record<ConnectionState, string> = {
  live: "live",
  connecting: "connecting",
  disconnected: "disconnected",
  stopped: "stopped (logs)",
};

export function serviceKey(projectId: string, serviceName: string): string {
  return `${projectId}::${serviceName}`;
}

export function getProject(projects: ProjectState[], projectId: string | null): ProjectState | null {
  if (!projectId) {
    return null;
  }
  return projects.find((project) => project.id === projectId) || null;
}

export function getService(
  projects: ProjectState[],
  projectId: string,
  serviceName: string,
): ProjectServiceState | null {
  const project = getProject(projects, projectId);
  if (!project) {
    return null;
  }
  return project.services.find((service) => service.name === serviceName) || null;
}

export function resolveSelectedService(
  project: ProjectState | null,
  selectedServiceByProject: Record<string, string>,
): ProjectServiceState | null {
  if (!project || !project.services.length || project.configError) {
    return null;
  }

  const selectedServiceName = selectedServiceByProject[project.id];
  const defaultService =
    project.services.find((entry) => entry.name === project.defaultService) || project.services[0];

  return project.services.find((entry) => entry.name === selectedServiceName) || defaultService || null;
}

export function normalizeSelection(
  projects: ProjectState[],
  selectedProjectId: string | null,
  selectedServiceByProject: Record<string, string>,
): {
  selectedProjectId: string | null;
  selectedServiceByProject: Record<string, string>;
} {
  let nextProjectId = selectedProjectId;
  if (!projects.length) {
    nextProjectId = null;
  } else if (!nextProjectId || !projects.some((project) => project.id === nextProjectId)) {
    nextProjectId = projects[0].id;
  }

  const nextSelectedServiceByProject: Record<string, string> = {};

  for (const project of projects) {
    if (project.configError || !project.services.length) {
      continue;
    }

    const selectedName = selectedServiceByProject[project.id];
    const selectedStillExists = project.services.some((service) => service.name === selectedName);
    const fallback =
      project.services.find((service) => service.name === project.defaultService) || project.services[0];
    const selected = selectedStillExists
      ? project.services.find((service) => service.name === selectedName)
      : fallback;

    if (selected) {
      nextSelectedServiceByProject[project.id] = selected.name;
    }
  }

  return {
    selectedProjectId: nextProjectId,
    selectedServiceByProject: nextSelectedServiceByProject,
  };
}

export function serviceLifecycleStatus(service: ProjectServiceState | null): ServiceLifecycleStatus {
  if (!service) {
    return "stopped";
  }
  if (typeof service.status === "string" && service.status) {
    return service.status;
  }
  if (!service.running) {
    return "stopped";
  }
  return service.ready === false ? "starting" : "ready";
}

export function lifecycleBadgeClass(status: ServiceLifecycleStatus): string {
  const map: Record<string, string> = {
    ready: "badge badge-success badge-soft",
    starting: "badge badge-info badge-soft",
    stopped: "badge badge-neutral badge-soft",
    error: "badge badge-error badge-soft",
  };
  return map[status] || "badge badge-neutral badge-soft";
}

export function connectionBadgeClass(connectionState: ConnectionState): string {
  const map: Record<ConnectionState, string> = {
    live: "badge badge-success badge-soft",
    connecting: "badge badge-info badge-soft",
    disconnected: "badge badge-neutral badge-soft",
    stopped: "badge badge-warning badge-soft",
  };
  return map[connectionState] || "badge badge-neutral badge-soft";
}

export function historyTypeBadgeClass(type: string): string {
  const map: Record<string, string> = {
    start: "badge badge-success badge-soft",
    stop_requested: "badge badge-warning badge-soft",
    restart_requested: "badge badge-info badge-soft",
    stdin_command: "badge badge-primary badge-soft",
    exit: "badge badge-neutral badge-soft",
  };
  return map[type] || "badge badge-neutral badge-soft";
}

export function formatHistoryTime(isoTimestamp?: string): string {
  if (!isoTimestamp) {
    return "--:--:--";
  }

  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortRunId(runId?: string): string {
  if (!runId) {
    return "";
  }
  return String(runId).slice(0, 8);
}

export function historyEventLabel(type: string): string {
  const labels: Record<string, string> = {
    start: "start",
    stop_requested: "stop",
    restart_requested: "restart",
    stdin_command: "stdin",
    exit: "exit",
  };
  return labels[type] || type || "event";
}

export function historyEventSummary(event: HistoryEvent): string {
  const data = event && typeof event.data === "object" && event.data ? event.data : {};
  if (event.type === "start") {
    const cmd = typeof data.cmd === "string" ? data.cmd : "";
    return cmd ? `$ ${cmd}` : "service started";
  }

  if (event.type === "stdin_command") {
    const command = typeof data.command === "string" ? data.command : "";
    return command ? `> ${command}` : "stdin input";
  }

  if (event.type === "exit") {
    const code = typeof data.exitCode === "number" ? data.exitCode : "?";
    const replaced = data.replacedByRestart === true;
    const stopRequested = data.stopRequested === true;
    if (replaced) {
      return `exit code ${code} (replaced by restart)`;
    }
    if (stopRequested) {
      return `exit code ${code} (stop requested)`;
    }
    return `exit code ${code}`;
  }

  if (event.type === "restart_requested") {
    return "restart requested";
  }

  if (event.type === "stop_requested") {
    return "stop requested";
  }

  return "event";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
