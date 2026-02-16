"use client";

import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { HISTORY_LIMIT, devrunApi } from "../lib/devrunApi";
import {
  getProject,
  getService,
  normalizeSelection,
  resolveSelectedService,
  serviceKey,
  sleep,
} from "../lib/devrunUtils";
import type {
  ConnectTerminalOptions,
  ConnectionState,
  HistoryEntry,
  HistoryEvent,
  LoadRecentLogsOptions,
  OpenTerminalOptions,
  ProcessAction,
  ProjectServiceConfigInput,
  ProjectServiceState,
  ProjectState,
  SocketMessage,
  TerminalEntry,
  XtermModules,
} from "../types";
import { useDevrunStore } from "../store/devrunStore";

export interface DevrunAppModel {
  projects: ProjectState[];
  selectedProjectId: string | null;
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  terminalKeys: string[];
  activeTerminalKey: string | null;
  terminalEmptyMessage: string;
  selectedHistoryEntry: HistoryEntry | null;
  historyEvents: HistoryEvent[];
  historyItems: HistoryEvent[];
  getServiceConnectionState: (
    project: ProjectState,
    service: ProjectServiceState,
  ) => ConnectionState;
  addProject: () => Promise<void>;
  configureProject: (project: ProjectState) => Promise<void>;
  removeProject: (project: ProjectState) => Promise<void>;
  selectProject: (project: ProjectState, preferredServiceName?: string) => Promise<void>;
  onAction: (
    action: ProcessAction,
    project: ProjectState,
    service: ProjectServiceState,
  ) => Promise<void>;
  attachTerminalContainer: (key: string, node: HTMLDivElement | null) => void;
}

export function useDevrunApp(): DevrunAppModel {
  const {
    projects,
    selectedProjectId,
    selectedServiceByProject,
    historyByService,
    activeTerminalKey,
    terminalKeys,
    terminalVersion,
    setProjects,
    setSelectedProjectId,
    setSelectedServiceByProject,
    setHistoryByService,
    setActiveTerminalKey,
    addTerminalKey,
    bumpTerminalVersion,
    resetState,
  } = useDevrunStore(
    useShallow((state) => ({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      selectedServiceByProject: state.selectedServiceByProject,
      historyByService: state.historyByService,
      activeTerminalKey: state.activeTerminalKey,
      terminalKeys: state.terminalKeys,
      terminalVersion: state.terminalVersion,
      setProjects: state.setProjects,
      setSelectedProjectId: state.setSelectedProjectId,
      setSelectedServiceByProject: state.setSelectedServiceByProject,
      setHistoryByService: state.setHistoryByService,
      setActiveTerminalKey: state.setActiveTerminalKey,
      addTerminalKey: state.addTerminalKey,
      bumpTerminalVersion: state.bumpTerminalVersion,
      resetState: state.resetState,
    })),
  );

  const historyRequestSeqRef = useRef(0);
  const pollHandleRef = useRef<number | null>(null);
  const terminalsRef = useRef<Map<string, TerminalEntry>>(new Map());
  const xtermModulesRef = useRef<Promise<XtermModules> | null>(null);

  const selectedProject = useMemo(
    () => getProject(projects, selectedProjectId),
    [projects, selectedProjectId],
  );

  const selectedService = useMemo(
    () => resolveSelectedService(selectedProject, selectedServiceByProject),
    [selectedProject, selectedServiceByProject],
  );

  const selectedHistoryKey =
    selectedProject && selectedService
      ? serviceKey(selectedProject.id, selectedService.name)
      : "";
  const selectedHistoryEntry = selectedHistoryKey ? historyByService[selectedHistoryKey] || null : null;

  function getRuntimeSnapshot() {
    const snapshot = useDevrunStore.getState();
    return {
      projects: snapshot.projects,
      selectedProjectId: snapshot.selectedProjectId,
      selectedServiceByProject: snapshot.selectedServiceByProject,
      activeTerminalKey: snapshot.activeTerminalKey,
    };
  }

  function mapsEqual(
    left: Record<string, string>,
    right: Record<string, string>,
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (left[key] !== right[key]) {
        return false;
      }
    }

    return true;
  }

  async function loadXtermModules(): Promise<XtermModules> {
    if (!xtermModulesRef.current) {
      xtermModulesRef.current = Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
    }

    return xtermModulesRef.current;
  }

  function updateEntryStatus(entry: TerminalEntry, connectionState: ConnectionState) {
    if (entry.connectionState === connectionState) {
      return;
    }

    entry.connectionState = connectionState;
    bumpTerminalVersion();
  }

  function setEntryReadOnly(entry: TerminalEntry, readOnly: boolean) {
    entry.readOnly = readOnly;
    if (entry.term) {
      entry.term.options.disableStdin = readOnly;
    }
  }

  function writeNotice(entry: TerminalEntry, text: string) {
    if (!text || entry.lastNotice === text || !entry.term) {
      return;
    }

    entry.lastNotice = text;
    entry.term.writeln(`\r\n[${text}]`);
  }

  function closeEntrySocket(entry: TerminalEntry, code = 1000, reason = "Reconnect") {
    const socket = entry.socket;
    if (!socket) {
      return;
    }

    entry.socket = null;
    try {
      socket.close(code, reason);
    } catch {
      // ignore close race
    }
  }

  function sendResize(entry: TerminalEntry) {
    if (!entry.socket || entry.socket.readyState !== WebSocket.OPEN || !entry.term) {
      return;
    }

    entry.socket.send(
      JSON.stringify({
        type: "resize",
        cols: entry.term.cols,
        rows: entry.term.rows,
      }),
    );
  }

  function markDisconnected(
    entry: TerminalEntry,
    reason: string,
    nextState: ConnectionState = "disconnected",
  ) {
    closeEntrySocket(entry);
    setEntryReadOnly(entry, true);
    updateEntryStatus(entry, nextState);
    writeNotice(entry, reason);
  }

  async function ensureTerminalMounted(entry: TerminalEntry): Promise<boolean> {
    if (entry.term || !entry.container) {
      return Boolean(entry.term);
    }

    const [{ Terminal }, { FitAddon }] = await loadXtermModules();
    if (entry.term || !entry.container) {
      return Boolean(entry.term);
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "JetBrains Mono, Menlo, monospace",
      convertEol: true,
      theme: {
        background: "#0b1020",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(entry.container);
    fitAddon.fit();

    entry.term = term;
    entry.fitAddon = fitAddon;
    setEntryReadOnly(entry, true);

    term.onData((data: string) => {
      if (entry.readOnly) {
        return;
      }

      if (entry.socket && entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const onWindowResize = () => {
      if (!terminalsRef.current.has(entry.key) || !entry.fitAddon) {
        return;
      }
      entry.fitAddon.fit();
      sendResize(entry);
    };

    window.addEventListener("resize", onWindowResize);
    entry.onWindowResize = onWindowResize;

    return true;
  }

  async function waitForTerminalMount(entry: TerminalEntry): Promise<boolean> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (entry.term) {
        return true;
      }

      if (entry.container) {
        const mounted = await ensureTerminalMounted(entry);
        if (mounted) {
          return true;
        }
      }

      await sleep(16);
    }

    return false;
  }

  async function loadRecentLogs(
    entry: TerminalEntry,
    projectId: string,
    serviceName: string,
    options: LoadRecentLogsOptions = {},
  ): Promise<void> {
    const showBanner = options.showBanner !== false;
    const runId = options.runId || undefined;

    closeEntrySocket(entry);
    setEntryReadOnly(entry, true);
    updateEntryStatus(entry, "stopped");

    try {
      const payload = await devrunApi.logs(projectId, serviceName, 12_000, runId);
      const output = typeof payload.output === "string" ? payload.output : "";
      if (payload.runId) {
        entry.lastKnownRunId = payload.runId;
      }

      if (!output) {
        if (showBanner) {
          writeNotice(entry, "service stopped; no recent logs available");
        }
        return;
      }

      if (output === entry.lastLogSnapshot) {
        return;
      }

      if (showBanner && entry.term) {
        entry.term.writeln("\r\n[showing recent logs for stopped service]");
      }
      entry.term?.write(output);
      entry.lastLogSnapshot = output;
    } catch (error) {
      writeNotice(entry, error instanceof Error ? error.message : "failed to load recent logs");
    }
  }

  async function connectTerminalSocket(
    entry: TerminalEntry,
    project: ProjectState,
    service: ProjectServiceState,
    options: ConnectTerminalOptions = {},
  ): Promise<void> {
    const force = Boolean(options.force);
    const replay = options.replay !== false;
    const showSeparator = Boolean(options.showSeparator);
    const expectedRunId = options.expectedRunId || service.runId || "";

    if (!force && entry.socket) {
      const readyState = entry.socket.readyState;
      if (readyState === WebSocket.CONNECTING || readyState === WebSocket.OPEN) {
        return;
      }
    }

    if (force) {
      closeEntrySocket(entry, 1000, "Reconnect");
    }

    if (showSeparator && entry.term) {
      entry.term.writeln("\r\n[reconnecting terminal to current process]");
    }

    setEntryReadOnly(entry, false);
    updateEntryStatus(entry, "connecting");
    entry.lastNotice = "";
    entry.lastLogSnapshot = "";

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws?projectId=${encodeURIComponent(project.id)}&serviceName=${encodeURIComponent(service.name)}&replay=${replay ? "1" : "0"}${expectedRunId ? `&runId=${encodeURIComponent(expectedRunId)}` : ""}`;
    const socket = new WebSocket(url);
    entry.socket = socket;

    socket.addEventListener("open", () => {
      if (entry.socket !== socket) {
        return;
      }

      updateEntryStatus(entry, "live");
      entry.hasConnected = true;
      entry.lastNotice = "";
      writeNotice(entry, "connected to running process");
      sendResize(entry);
      if (entry.key === useDevrunStore.getState().activeTerminalKey) {
        entry.term?.focus();
      }
    });

    socket.addEventListener("message", (event) => {
      if (entry.socket !== socket) {
        return;
      }

      try {
        const raw = typeof event.data === "string" ? event.data : "";
        if (!raw) {
          return;
        }
        const message = JSON.parse(raw) as SocketMessage;

        if (message.type === "meta" && message.runId) {
          entry.runId = message.runId;
          entry.lastKnownRunId = message.runId;
        }

        if (message.type === "output" && typeof message.data === "string") {
          entry.term?.write(message.data);
        }

        if (message.type === "error" && message.error) {
          writeNotice(entry, message.error);
        }

        if (message.type === "exited") {
          if (message.runId) {
            entry.lastKnownRunId = message.runId;
          }
          const exitCode = typeof message.exitCode === "number" ? message.exitCode : "?";
          markDisconnected(entry, `process exited ${exitCode}`, "stopped");
        }
      } catch {
        // ignore malformed ws output
      }
    });

    socket.addEventListener("close", () => {
      if (entry.socket !== socket) {
        return;
      }

      entry.socket = null;
      if (entry.connectionState !== "stopped") {
        markDisconnected(entry, "terminal disconnected", "disconnected");
      }
    });

    socket.addEventListener("error", () => {
      if (entry.socket !== socket) {
        return;
      }
      writeNotice(entry, "socket error");
    });
  }

  async function ensureTerminalEntry(
    project: ProjectState,
    service: ProjectServiceState,
  ): Promise<TerminalEntry> {
    const key = serviceKey(project.id, service.name);
    const existing = terminalsRef.current.get(key);
    if (existing) {
      existing.projectName = project.name;
      existing.serviceName = service.name;
      await waitForTerminalMount(existing);
      return existing;
    }

    const entry: TerminalEntry = {
      key,
      projectId: project.id,
      projectName: project.name,
      serviceName: service.name,
      term: null,
      fitAddon: null,
      socket: null,
      container: null,
      connectionState: "disconnected",
      readOnly: true,
      hasConnected: false,
      lastNotice: "",
      lastLogSnapshot: "",
      runId: null,
      lastKnownRunId: null,
      onWindowResize: null,
    };

    terminalsRef.current.set(key, entry);
    addTerminalKey(key);
    bumpTerminalVersion();

    const mounted = await waitForTerminalMount(entry);
    if (!mounted) {
      throw new Error("Terminal failed to initialize");
    }

    return entry;
  }

  function syncTerminalEntries(nextProjects: ProjectState[]) {
    for (const entry of terminalsRef.current.values()) {
      const project = getProject(nextProjects, entry.projectId);
      if (project) {
        entry.projectName = project.name;
      }

      const service = getService(nextProjects, entry.projectId, entry.serviceName);
      if (!service) {
        markDisconnected(entry, "service no longer exists", "disconnected");
        continue;
      }

      if (
        service.running &&
        service.runId &&
        entry.connectionState === "live" &&
        entry.runId &&
        service.runId !== entry.runId
      ) {
        markDisconnected(entry, "attached to stale run; reconnect needed", "disconnected");
      }

      if (service.lastRunId) {
        entry.lastKnownRunId = service.lastRunId;
      }

      if (!service.running && entry.connectionState === "live") {
        markDisconnected(entry, "service stopped", "stopped");
      }
    }
  }

  function isServiceRunning(
    projectId: string,
    serviceName: string,
    sourceProjects = useDevrunStore.getState().projects,
  ): boolean {
    const service = getService(sourceProjects, projectId, serviceName);
    return Boolean(service?.running);
  }

  async function openTerminal(
    project: ProjectState,
    service: ProjectServiceState,
    options: OpenTerminalOptions = {},
  ): Promise<void> {
    const entry = await ensureTerminalEntry(project, service);

    setActiveTerminalKey(entry.key);
    bumpTerminalVersion();

    const running = isServiceRunning(project.id, service.name);
    if (running) {
      const replay = options.freshRun ? true : !entry.hasConnected;
      await connectTerminalSocket(entry, project, service, {
        force: options.forceReconnect,
        replay,
        showSeparator: options.showSeparator,
        expectedRunId: service.runId,
      });
      return;
    }

    await loadRecentLogs(entry, project.id, service.name, {
      showBanner: true,
      runId: service.lastRunId || entry.lastKnownRunId,
    });
  }

  async function openSelectedServiceTerminal(options: OpenTerminalOptions = {}) {
    const snapshot = getRuntimeSnapshot();
    const project = getProject(snapshot.projects, snapshot.selectedProjectId);
    const service = resolveSelectedService(project, snapshot.selectedServiceByProject);
    if (!project || !service) {
      return;
    }

    const key = serviceKey(project.id, service.name);
    const entry = terminalsRef.current.get(key);
    const running = Boolean(service.running);
    const attached =
      entry &&
      snapshot.activeTerminalKey === key &&
      ((running && (entry.connectionState === "live" || entry.connectionState === "connecting")) ||
        (!running && entry.connectionState === "stopped"));

    if (attached && !options.forceReconnect) {
      return;
    }

    await openTerminal(project, service, {
      forceReconnect: Boolean(options.forceReconnect),
      freshRun: Boolean(options.freshRun),
      showSeparator: Boolean(options.showSeparator),
    });
  }

  async function refreshHistoryFor(
    project: ProjectState | null,
    service: ProjectServiceState | null,
  ): Promise<void> {
    if (!project || !service) {
      return;
    }

    const key = serviceKey(project.id, service.name);
    const requestSeq = historyRequestSeqRef.current + 1;
    historyRequestSeqRef.current = requestSeq;

    setHistoryByService((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || {}),
        loading: true,
        error: "",
      } as HistoryEntry,
    }));

    try {
      const payload = await devrunApi.history(project.id, service.name, 0, HISTORY_LIMIT);
      if (historyRequestSeqRef.current !== requestSeq) {
        return;
      }

      setHistoryByService((previous) => ({
        ...previous,
        [key]: {
          loading: false,
          error: "",
          events: Array.isArray(payload.events) ? payload.events : [],
          latestSeq: typeof payload.latestSeq === "number" ? payload.latestSeq : 0,
          retention: typeof payload.retention === "number" ? payload.retention : HISTORY_LIMIT,
          fetchedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      if (historyRequestSeqRef.current !== requestSeq) {
        return;
      }

      setHistoryByService((previous) => ({
        ...previous,
        [key]: {
          ...(previous[key] || {
            loading: false,
            error: "",
            events: [],
            latestSeq: 0,
            retention: HISTORY_LIMIT,
          }),
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load history",
        },
      }));
    }
  }

  async function refreshSelectedServiceHistory() {
    const snapshot = getRuntimeSnapshot();
    const project = getProject(snapshot.projects, snapshot.selectedProjectId);
    const service = resolveSelectedService(project, snapshot.selectedServiceByProject);
    await refreshHistoryFor(project, service);
  }

  async function refreshState() {
    const payload = await devrunApi.state();
    const nextProjects = Array.isArray(payload.projects) ? payload.projects : [];

    const previous = getRuntimeSnapshot();
    const normalized = normalizeSelection(
      nextProjects,
      previous.selectedProjectId,
      previous.selectedServiceByProject,
    );

    setProjects(nextProjects);
    if (previous.selectedProjectId !== normalized.selectedProjectId) {
      setSelectedProjectId(normalized.selectedProjectId);
    }
    if (!mapsEqual(previous.selectedServiceByProject, normalized.selectedServiceByProject)) {
      setSelectedServiceByProject(normalized.selectedServiceByProject);
    }

    syncTerminalEntries(nextProjects);

    const validHistoryKeys = new Set<string>();
    for (const project of nextProjects) {
      for (const service of project.services) {
        validHistoryKeys.add(serviceKey(project.id, service.name));
      }
    }
    setHistoryByService((previousHistory) => {
      let changed = false;
      const pruned: Record<string, HistoryEntry | undefined> = {};
      for (const [key, value] of Object.entries(previousHistory)) {
        if (validHistoryKeys.has(key)) {
          pruned[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? pruned : previousHistory;
    });

    const project = getProject(nextProjects, normalized.selectedProjectId);
    const service = resolveSelectedService(project, normalized.selectedServiceByProject);
    if (project && service) {
      const key = serviceKey(project.id, service.name);
      if (previous.activeTerminalKey !== key) {
        setActiveTerminalKey(key);
      }
      if (!terminalsRef.current.has(key)) {
        void openTerminal(project, service).catch(() => {
          // best effort during polling
        });
      }
    } else {
      if (previous.activeTerminalKey !== null) {
        setActiveTerminalKey(null);
      }
    }

    await refreshSelectedServiceHistory();
  }

  async function onAction(
    action: ProcessAction,
    project: ProjectState,
    service: ProjectServiceState,
  ): Promise<void> {
    try {
      await devrunApi.processAction(action, project.id, service.name);
      await refreshState();

      const snapshot = getRuntimeSnapshot();
      const currentProject = getProject(snapshot.projects, project.id) || project;
      const currentService = getService(snapshot.projects, project.id, service.name) || service;

      if (action === "start" || action === "restart") {
        await openTerminal(currentProject, currentService, {
          forceReconnect: true,
          freshRun: true,
          showSeparator: true,
        });
      }

      if (action === "stop") {
        const key = serviceKey(project.id, service.name);
        if (terminalsRef.current.has(key)) {
          await openTerminal(currentProject, currentService, {
            forceReconnect: false,
            freshRun: false,
            showSeparator: false,
          });
        }
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `Failed to ${action} service`);
    }
  }

  async function configureProject(project: ProjectState): Promise<void> {
    const nameInput = window.prompt("Display name (optional):", project.name || "");
    if (nameInput === null) {
      return;
    }

    const services: ProjectServiceConfigInput[] = [];
    let index = 0;

    while (true) {
      const existing = project.services[index] || {};
      const defaultName = existing.name || (index === 0 ? "web" : `service-${index + 1}`);
      const serviceNameInput = window.prompt(
        `Service ${index + 1} name (leave blank to finish):`,
        defaultName,
      );

      if (serviceNameInput === null) {
        if (!services.length) {
          return;
        }
        break;
      }

      const serviceName = serviceNameInput.trim();
      if (!serviceName) {
        if (!services.length) {
          window.alert("At least one service is required.");
          continue;
        }
        break;
      }

      const defaultCmd = existing.cmd || "npm run dev";
      const cmdInput = window.prompt(`Command for '${serviceName}':`, defaultCmd);
      if (cmdInput === null) {
        if (!services.length) {
          return;
        }
        continue;
      }

      const cmd = cmdInput.trim();
      if (!cmd) {
        window.alert("Command cannot be empty.");
        continue;
      }

      const cwdInput = window.prompt(
        `Working directory for '${serviceName}' (optional, relative to project root):`,
        existing.cwd || "",
      );
      const cwd = (cwdInput || "").trim();

      const nextService: ProjectServiceConfigInput = { name: serviceName, cmd };
      if (cwd) {
        nextService.cwd = cwd;
      }
      services.push(nextService);

      index += 1;
      if (!window.confirm("Add another service?")) {
        break;
      }
    }

    try {
      const existingDefault = project.defaultService || services[0]?.name || "";
      const defaultInput = window.prompt(
        "Default service name (optional; press Enter for first service):",
        existingDefault,
      );
      if (defaultInput === null) {
        return;
      }

      const desiredDefault = (defaultInput || "").trim();
      const defaultMatch =
        services.find((entry) => entry.name === desiredDefault) ||
        services.find((entry) => entry.name.toLowerCase() === desiredDefault.toLowerCase()) ||
        services[0];

      if (!defaultMatch) {
        window.alert("Default service must match one configured service.");
        return;
      }

      await devrunApi.setProjectConfig(
        project.id,
        nameInput.trim() || undefined,
        services,
        defaultMatch.name,
      );
      await refreshState();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save project config");
    }
  }

  async function removeProject(project: ProjectState): Promise<void> {
    const shouldRemove = window.confirm(`Remove ${project.name} from Devrun list?`);
    if (!shouldRemove) {
      return;
    }

    try {
      await devrunApi.removeProject(project.id);
      await refreshState();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to remove project");
    }
  }

  async function addProject(): Promise<void> {
    const root = window.prompt("Project root path (absolute or relative):");
    if (!root) {
      return;
    }

    const name = window.prompt("Display name (optional):") || undefined;
    try {
      await devrunApi.addProject(root, name);
      await refreshState();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to add project");
    }
  }

  async function selectProject(
    project: ProjectState,
    preferredServiceName?: string,
  ): Promise<void> {
    const snapshot = getRuntimeSnapshot();
    const selection = { ...snapshot.selectedServiceByProject };
    const preferred =
      project.services.find((service) => service.name === preferredServiceName) || null;
    const service = preferred || resolveSelectedService(project, selection);

    if (service) {
      selection[project.id] = service.name;
    }

    setSelectedProjectId(project.id);
    setSelectedServiceByProject({
      ...snapshot.selectedServiceByProject,
      ...(service ? { [project.id]: service.name } : {}),
    });

    if (!service) {
      setActiveTerminalKey(null);
      return;
    }

    const key = serviceKey(project.id, service.name);
    setActiveTerminalKey(key);

    await openTerminal(project, service).catch((error) => {
      window.alert(error instanceof Error ? error.message : "Failed to open terminal");
    });

    await refreshHistoryFor(project, service);
  }

  function getServiceConnectionState(
    project: ProjectState,
    service: ProjectServiceState,
  ): ConnectionState {
    const key = serviceKey(project.id, service.name);
    const entry = terminalsRef.current.get(key);
    if (entry) {
      return entry.connectionState;
    }
    return service.running ? "live" : "stopped";
  }

  function attachTerminalContainer(key: string, node: HTMLDivElement | null) {
    const entry = terminalsRef.current.get(key);
    if (!entry) {
      return;
    }

    entry.container = node;
    if (node) {
      void ensureTerminalMounted(entry);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await refreshState();
      if (cancelled) {
        return;
      }

      await openSelectedServiceTerminal();
      if (cancelled) {
        return;
      }

      pollHandleRef.current = window.setInterval(() => {
        void refreshState().catch(() => {
          // keep current UI if polling fails
        });
      }, 2000);
    })().catch((error) => {
      if (!cancelled) {
        window.alert(error instanceof Error ? error.message : "Failed to initialize app");
      }
    });

    return () => {
      cancelled = true;

      if (pollHandleRef.current) {
        window.clearInterval(pollHandleRef.current);
        pollHandleRef.current = null;
      }

      for (const entry of terminalsRef.current.values()) {
        closeEntrySocket(entry, 1000, "App closing");
        if (entry.onWindowResize) {
          window.removeEventListener("resize", entry.onWindowResize);
        }
        entry.term?.dispose();
      }
      terminalsRef.current.clear();
      resetState();
    };
  }, []);

  useEffect(() => {
    if (!activeTerminalKey) {
      return;
    }

    const entry = terminalsRef.current.get(activeTerminalKey);
    if (!entry || !entry.fitAddon) {
      return;
    }

    entry.fitAddon.fit();
    sendResize(entry);
    entry.term?.focus();
  }, [activeTerminalKey, terminalVersion]);

  const terminalEmptyMessage = useMemo(() => {
    if (!selectedProject) {
      return "Select a project to open a terminal.";
    }
    if (selectedProject.configError || !selectedProject.services.length) {
      return "Configure a service to open a terminal.";
    }
    return "";
  }, [selectedProject]);

  const historyEvents = Array.isArray(selectedHistoryEntry?.events)
    ? selectedHistoryEntry.events
    : [];
  const historyItems = historyEvents.slice(-10).reverse();

  return {
    projects,
    selectedProjectId,
    selectedProject,
    selectedService,
    terminalKeys,
    activeTerminalKey,
    terminalEmptyMessage,
    selectedHistoryEntry,
    historyEvents,
    historyItems,
    getServiceConnectionState,
    addProject,
    configureProject,
    removeProject,
    selectProject,
    onAction,
    attachTerminalContainer,
  };
}
