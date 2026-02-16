import type {
  HistoryResponse,
  LogsResponse,
  ProcessAction,
  ProcessActionResponse,
  ProjectServiceConfigInput,
  StateResponse,
} from "../types";

export const HISTORY_LIMIT = 100;

async function request<T>(
  pathname: string,
  init?: RequestInit,
  fallbackMessage?: string,
): Promise<T> {
  const response = await fetch(pathname, init);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    hint?: string;
  };

  if (!response.ok) {
    throw new Error(body.error || body.hint || fallbackMessage || "Request failed");
  }

  return body as T;
}

export const devrunApi = {
  state(): Promise<StateResponse> {
    return request<StateResponse>("/api/state", undefined, "Failed to load state");
  },

  addProject(root: string, name?: string): Promise<unknown> {
    return request(
      "/api/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root, name }),
      },
      "Failed to add project",
    );
  },

  async removeProject(projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });

    if (!response.ok && response.status !== 204) {
      throw new Error("Failed to remove project");
    }
  },

  processAction(
    action: ProcessAction,
    projectId: string,
    serviceName: string,
  ): Promise<ProcessActionResponse> {
    return request<ProcessActionResponse>(
      `/api/process/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, serviceName }),
      },
      `Failed to ${action}`,
    );
  },

  setProjectConfig(
    projectId: string,
    name: string | undefined,
    services: ProjectServiceConfigInput[],
    defaultService: string,
  ): Promise<unknown> {
    return request(
      "/api/project-config",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, services, defaultService }),
      },
      "Failed to save project config",
    );
  },

  logs(
    projectId: string,
    serviceName: string,
    chars = 8000,
    runId?: string,
  ): Promise<LogsResponse> {
    const query = new URLSearchParams({
      projectId,
      serviceName,
      chars: String(chars),
    });

    if (runId) {
      query.set("runId", runId);
    }

    return request<LogsResponse>(`/api/logs?${query.toString()}`, undefined, "Failed to fetch logs");
  },

  history(
    projectId: string,
    serviceName: string,
    afterSeq = 0,
    limit = HISTORY_LIMIT,
  ): Promise<HistoryResponse> {
    const query = new URLSearchParams({
      projectId,
      serviceName,
      afterSeq: String(afterSeq),
      limit: String(limit),
    });

    return request<HistoryResponse>(
      `/api/history?${query.toString()}`,
      undefined,
      "Failed to fetch history",
    );
  },
};
