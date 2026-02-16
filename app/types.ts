import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";

export type ProcessAction = "start" | "stop" | "restart";

export type ConnectionState = "live" | "connecting" | "disconnected" | "stopped";

export type ServiceLifecycleStatus = "ready" | "starting" | "stopped" | "error" | string;

export interface ProjectServiceConfigInput {
  name: string;
  cmd: string;
  cwd?: string;
}

export interface ProjectServiceState {
  name: string;
  cmd: string;
  cwd?: string;
  running: boolean;
  status?: ServiceLifecycleStatus;
  ready?: boolean;
  runId?: string;
  lastRunId?: string;
}

export interface ProjectState {
  id: string;
  name: string;
  root: string;
  configPath?: string;
  configError?: string;
  defaultService?: string;
  services: ProjectServiceState[];
}

export interface StateResponse {
  projects: ProjectState[];
}

export interface HistoryEvent {
  seq: number;
  ts?: string;
  type: string;
  runId?: string;
  data?: Record<string, unknown>;
}

export interface HistoryResponse {
  events?: HistoryEvent[];
  latestSeq?: number;
  retention?: number;
}

export interface HistoryEntry {
  loading: boolean;
  error: string;
  events: HistoryEvent[];
  latestSeq: number;
  retention: number;
  fetchedAt?: string;
}

export interface LogsResponse {
  output?: string;
  runId?: string;
}

export interface ProcessActionResponse {
  ok?: boolean;
}

export interface TerminalEntry {
  key: string;
  projectId: string;
  projectName: string;
  serviceName: string;
  term: XTermTerminal | null;
  fitAddon: FitAddon | null;
  socket: WebSocket | null;
  container: HTMLDivElement | null;
  connectionState: ConnectionState;
  readOnly: boolean;
  hasConnected: boolean;
  lastNotice: string;
  lastLogSnapshot: string;
  runId: string | null;
  lastKnownRunId: string | null;
  onWindowResize: (() => void) | null;
}

export type SocketMessage = {
  type?: string;
  runId?: string;
  data?: string;
  error?: string;
  exitCode?: number;
};

export interface OpenTerminalOptions {
  forceReconnect?: boolean;
  freshRun?: boolean;
  showSeparator?: boolean;
}

export interface ConnectTerminalOptions {
  force?: boolean;
  replay?: boolean;
  showSeparator?: boolean;
  expectedRunId?: string;
}

export interface LoadRecentLogsOptions {
  showBanner?: boolean;
  runId?: string | null;
}

export type XtermModules = [typeof import("@xterm/xterm"), typeof import("@xterm/addon-fit")];
