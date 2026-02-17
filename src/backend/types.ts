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
  port?: number;
};

export type ProjectConfig = {
  name?: string;
  defaultService?: string;
  services: ProjectService[];
};

export type TerminalMode = "pty" | "pipe";
export type ServiceStatus = "starting" | "ready" | "stopped" | "error";

export type ServiceRuntimeState = {
  name: string;
  cmd: string;
  cwd?: string;
  running: boolean;
  status?: ServiceStatus;
  ready?: boolean;
  runId?: string;
  lastRunId?: string;
  startedAt?: string;
  terminalMode?: TerminalMode;
  ptyAvailable?: boolean;
  warnings?: string[];
  effectiveUrl?: string;
  port?: number;
  lastExitCode?: number;
  exitWasRestartReplace?: boolean;
  exitWasStopRequest?: boolean;
};

export type RunningService = {
  projectId: string;
  serviceName: string;
  startedAt: string;
  runId: string;
  status: ServiceStatus;
  ready: boolean;
  terminalMode: TerminalMode;
  ptyAvailable: boolean;
  warnings: string[];
  effectiveUrl?: string;
  port?: number;
};

export type ServiceHistoryEventType =
  | "start"
  | "stop_requested"
  | "restart_requested"
  | "stdin_command"
  | "exit";

export type ServiceHistoryEvent = {
  seq: number;
  ts: string;
  projectId: string;
  serviceName: string;
  runId?: string;
  type: ServiceHistoryEventType;
  data?: Record<string, unknown>;
};

export type ProjectState = {
  id: string;
  name: string;
  root: string;
  configPath: string;
  defaultService?: string;
  services: ServiceRuntimeState[];
  configError?: string;
};
