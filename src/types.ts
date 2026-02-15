export type RegistryEntry = {
  id: string;
  name: string;
  root: string;
  createdAt: string;
};

export type ProjectService = {
  name: string;
  cmd: string;
  cwd?: string;
};

export type ProjectConfig = {
  name?: string;
  services: ProjectService[];
};

export type ServiceRuntimeState = {
  name: string;
  cmd: string;
  cwd?: string;
  running: boolean;
  runId?: string;
  lastRunId?: string;
};

export type RunningService = {
  projectId: string;
  serviceName: string;
  startedAt: string;
  runId: string;
};

export type ProjectState = {
  id: string;
  name: string;
  root: string;
  configPath: string;
  services: ServiceRuntimeState[];
  configError?: string;
};
