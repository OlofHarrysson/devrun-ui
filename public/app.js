(() => {
  const state = {
    projects: [],
    selectedProjectId: null,
    selectedServiceByProject: new Map(),
    terminals: new Map(),
    historyByService: new Map(),
    historyRequestSeq: 0,
    activeTerminalKey: null,
    pollHandle: null,
  };

  const stateLabelByKey = {
    live: "live",
    connecting: "connecting",
    disconnected: "disconnected",
    stopped: "stopped (logs)",
  };

  const projectsEl = document.getElementById("projects");
  const projectHeaderEl = document.getElementById("project-header");
  const commandBarEl = document.getElementById("command-bar");
  const terminalTabsEl = document.getElementById("terminal-tabs");
  const terminalStackEl = document.getElementById("terminal-stack");
  const historyPanelEl = document.getElementById("history-panel");
  const addProjectBtn = document.getElementById("add-project-btn");

  const api = {
    async state() {
      const response = await fetch("/api/state");
      return response.json();
    },
    async addProject(root, name) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root, name }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to add project");
      }
      return response.json();
    },
    async removeProject(projectId) {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error("Failed to remove project");
      }
    },
    async processAction(action, projectId, serviceName) {
      const response = await fetch(`/api/process/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, serviceName }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Failed to ${action}`);
      }
      return response.json();
    },
    async setProjectConfig(projectId, name, services, defaultService) {
      const response = await fetch("/api/project-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, services, defaultService }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save project config");
      }
      return response.json();
    },
    async logs(projectId, serviceName, chars = 8000, runId) {
      const query = new URLSearchParams({
        projectId,
        serviceName,
        chars: String(chars),
      });
      if (runId) {
        query.set("runId", runId);
      }
      const response = await fetch(`/api/logs?${query.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch logs");
      }
      return response.json();
    },
    async history(projectId, serviceName, afterSeq = 0, limit = 100) {
      const query = new URLSearchParams({
        projectId,
        serviceName,
        afterSeq: String(afterSeq),
        limit: String(limit),
      });
      const response = await fetch(`/api/history?${query.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.hint || "Failed to fetch history");
      }
      return response.json();
    },
  };

  function serviceKey(projectId, serviceName) {
    return `${projectId}::${serviceName}`;
  }

  function selectedProject() {
    return state.projects.find((project) => project.id === state.selectedProjectId) || null;
  }

  function selectedService(project = selectedProject()) {
    if (!project || !project.services.length || project.configError) {
      return null;
    }

    const selectedServiceName = state.selectedServiceByProject.get(project.id);
    const defaultService =
      project.services.find((entry) => entry.name === project.defaultService) ||
      project.services[0];
    const service =
      project.services.find((entry) => entry.name === selectedServiceName) || defaultService;

    if (service) {
      state.selectedServiceByProject.set(project.id, service.name);
    }

    return service || null;
  }

  function getProject(projectId) {
    return state.projects.find((project) => project.id === projectId) || null;
  }

  function getService(projectId, serviceName) {
    const project = getProject(projectId);
    if (!project) {
      return null;
    }
    return project.services.find((service) => service.name === serviceName) || null;
  }

  function isServiceRunning(projectId, serviceName) {
    const service = getService(projectId, serviceName);
    return Boolean(service?.running);
  }

  function ensureSelectedProject() {
    if (!state.projects.length) {
      state.selectedProjectId = null;
      return;
    }

    const stillExists = state.projects.some((project) => project.id === state.selectedProjectId);
    if (!stillExists) {
      state.selectedProjectId = state.projects[0].id;
    }
  }

  function ensureSelectedServices() {
    for (const projectId of Array.from(state.selectedServiceByProject.keys())) {
      if (!state.projects.some((project) => project.id === projectId)) {
        state.selectedServiceByProject.delete(projectId);
      }
    }

    for (const project of state.projects) {
      if (project.configError || !project.services.length) {
        state.selectedServiceByProject.delete(project.id);
        continue;
      }

      const selectedName = state.selectedServiceByProject.get(project.id);
      const selectedStillExists = project.services.some((service) => service.name === selectedName);
      if (!selectedStillExists) {
        const fallback =
          project.services.find((service) => service.name === project.defaultService) ||
          project.services[0];
        state.selectedServiceByProject.set(project.id, fallback.name);
      }
    }
  }

  function updateEntryStatus(entry, connectionState) {
    if (entry.connectionState === connectionState) {
      return;
    }
    entry.connectionState = connectionState;
    renderTerminalTabs();
  }

  function setEntryReadOnly(entry, readOnly) {
    entry.readOnly = readOnly;
    entry.term.options.disableStdin = readOnly;
  }

  function writeNotice(entry, text) {
    if (!text || entry.lastNotice === text) {
      return;
    }
    entry.lastNotice = text;
    entry.term.writeln(`\r\n[${text}]`);
  }

  function closeEntrySocket(entry, code = 1000, reason = "Reconnect") {
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

  function markDisconnected(entry, reason, nextState = "disconnected") {
    closeEntrySocket(entry);
    setEntryReadOnly(entry, true);
    updateEntryStatus(entry, nextState);
    writeNotice(entry, reason);
  }

  async function loadRecentLogs(entry, projectId, serviceName, options = {}) {
    const showBanner = options.showBanner !== false;
    const runId = options.runId;

    closeEntrySocket(entry);
    setEntryReadOnly(entry, true);
    updateEntryStatus(entry, "stopped");

    try {
      const payload = await api.logs(projectId, serviceName, 12_000, runId);
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

      if (showBanner) {
        entry.term.writeln("\r\n[showing recent logs for stopped service]");
      }
      entry.term.write(output);
      entry.lastLogSnapshot = output;
    } catch (error) {
      writeNotice(entry, error instanceof Error ? error.message : "failed to load recent logs");
    }
  }

  async function connectTerminalSocket(entry, project, service, options = {}) {
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

    if (showSeparator) {
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
      if (entry.key === state.activeTerminalKey) {
        entry.term.focus();
      }
    });

    socket.addEventListener("message", (event) => {
      if (entry.socket !== socket) {
        return;
      }

      try {
        const message = JSON.parse(event.data);
        if (message.type === "meta" && message.runId) {
          entry.runId = message.runId;
          entry.lastKnownRunId = message.runId;
        }

        if (message.type === "output" && typeof message.data === "string") {
          entry.term.write(message.data);
        }

        if (message.type === "error" && message.error) {
          writeNotice(entry, message.error);
        }

        if (message.type === "exited") {
          if (message.runId) {
            entry.lastKnownRunId = message.runId;
          }
          markDisconnected(entry, `process exited ${message.exitCode}`, "stopped");
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

  function ensureTerminalEntry(project, service) {
    const key = serviceKey(project.id, service.name);
    const existing = state.terminals.get(key);
    if (existing) {
      existing.projectName = project.name;
      existing.serviceName = service.name;
      return existing;
    }

    if (!state.terminals.size) {
      terminalStackEl.innerHTML = "";
    }

    const container = document.createElement("div");
    container.className = "terminal-view";
    terminalStackEl.appendChild(container);

    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "JetBrains Mono, Menlo, monospace",
      convertEol: true,
      theme: {
        background: "#0b1020",
      },
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const entry = {
      key,
      projectId: project.id,
      projectName: project.name,
      serviceName: service.name,
      term,
      fitAddon,
      socket: null,
      container,
      connectionState: "disconnected",
      readOnly: true,
      hasConnected: false,
      lastNotice: "",
      lastLogSnapshot: "",
      runId: null,
      lastKnownRunId: null,
    };

    setEntryReadOnly(entry, true);

    term.onData((data) => {
      if (entry.readOnly) {
        return;
      }
      if (entry.socket && entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const onWindowResize = () => {
      if (!state.terminals.has(key)) {
        return;
      }
      fitAddon.fit();
      sendResize(entry);
    };
    window.addEventListener("resize", onWindowResize);
    entry.onWindowResize = onWindowResize;

    state.terminals.set(key, entry);
    return entry;
  }

  async function openTerminal(project, service, options = {}) {
    const entry = ensureTerminalEntry(project, service);
    state.activeTerminalKey = entry.key;
    renderTerminalTabs();

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

  function syncTerminalEntries() {
    for (const entry of state.terminals.values()) {
      const project = getProject(entry.projectId);
      if (project) {
        entry.projectName = project.name;
      }

      const service = getService(entry.projectId, entry.serviceName);
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

  function historyItemKey(projectId, serviceName) {
    return serviceKey(projectId, serviceName);
  }

  function formatHistoryTime(isoTimestamp) {
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

  function shortRunId(runId) {
    if (!runId) {
      return "";
    }
    return String(runId).slice(0, 8);
  }

  function historyEventLabel(type) {
    const labels = {
      start: "start",
      stop_requested: "stop",
      restart_requested: "restart",
      stdin_command: "stdin",
      exit: "exit",
    };
    return labels[type] || type || "event";
  }

  function historyEventSummary(event) {
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

  function renderHistoryPanel() {
    if (!historyPanelEl) {
      return;
    }

    const project = selectedProject();
    const service = selectedService(project);

    if (!project || !service || project.configError || !project.services.length) {
      historyPanelEl.innerHTML = `
        <div class="history-header">
          <div class="history-title">History</div>
        </div>
        <div class="history-empty">Select a configured service to view history.</div>
      `;
      return;
    }

    const key = historyItemKey(project.id, service.name);
    const entry = state.historyByService.get(key);
    const events = Array.isArray(entry?.events) ? entry.events : [];
    const items = events.slice(-10).reverse();

    let body = "";
    if (entry?.loading && !items.length) {
      body = '<div class="history-empty">Loading history…</div>';
    } else if (entry?.error && !items.length) {
      body = `<div class="history-empty">${escapeHtml(entry.error)}</div>`;
    } else if (!items.length) {
      body = '<div class="history-empty">No events yet for this service.</div>';
    } else {
      body = items
        .map((event) => {
          const summary = historyEventSummary(event);
          const run = shortRunId(event.runId);
          return `
            <div class="history-item">
              <div class="history-item-top">
                <span class="history-time">${escapeHtml(formatHistoryTime(event.ts))}</span>
                <span class="history-type">${escapeHtml(historyEventLabel(event.type))}</span>
                ${run ? `<span class="history-run">run ${escapeHtml(run)}</span>` : ""}
              </div>
              <div class="history-summary">${escapeHtml(summary)}</div>
            </div>
          `;
        })
        .join("");
    }

    historyPanelEl.innerHTML = `
      <div class="history-header">
        <div class="history-title">History</div>
        <div class="history-meta">${escapeHtml(service.name)} • ${events.length} events</div>
      </div>
      <div class="history-list">${body}</div>
    `;
  }

  async function refreshSelectedServiceHistory() {
    const project = selectedProject();
    const service = selectedService(project);
    if (!project || !service || !historyPanelEl) {
      renderHistoryPanel();
      return;
    }

    const key = historyItemKey(project.id, service.name);
    const previous = state.historyByService.get(key) || {};
    const requestSeq = state.historyRequestSeq + 1;
    state.historyRequestSeq = requestSeq;

    state.historyByService.set(key, {
      ...previous,
      loading: true,
      error: "",
    });
    renderHistoryPanel();

    try {
      const payload = await api.history(project.id, service.name, 0, 100);
      if (state.historyRequestSeq !== requestSeq) {
        return;
      }

      state.historyByService.set(key, {
        loading: false,
        error: "",
        events: Array.isArray(payload.events) ? payload.events : [],
        latestSeq: typeof payload.latestSeq === "number" ? payload.latestSeq : 0,
        retention: typeof payload.retention === "number" ? payload.retention : 100,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (state.historyRequestSeq !== requestSeq) {
        return;
      }
      state.historyByService.set(key, {
        ...previous,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load history",
      });
    }

    renderHistoryPanel();
  }

  async function openSelectedServiceTerminal(options = {}) {
    const project = selectedProject();
    const service = selectedService(project);
    if (!project || !service) {
      return;
    }

    const key = serviceKey(project.id, service.name);
    const entry = state.terminals.get(key);
    const isRunning = Boolean(service.running);
    const alreadyAttached =
      entry &&
      state.activeTerminalKey === key &&
      ((isRunning && (entry.connectionState === "live" || entry.connectionState === "connecting")) ||
        (!isRunning && entry.connectionState === "stopped"));

    if (alreadyAttached && !options.forceReconnect) {
      return;
    }

    await openTerminal(project, service, {
      forceReconnect: Boolean(options.forceReconnect),
      freshRun: Boolean(options.freshRun),
      showSeparator: Boolean(options.showSeparator),
    });
  }

  function renderProjects() {
    projectsEl.innerHTML = "";
    if (!state.projects.length) {
      projectsEl.innerHTML = '<div class="project-item">No projects yet.</div>';
      return;
    }

    for (const project of state.projects) {
      const runningCount = project.services.filter((service) => service.running).length;
      const item = document.createElement("button");
      item.className = `project-item ${project.id === state.selectedProjectId ? "active" : ""}`;
      item.innerHTML = `
        <div class="project-item-name">${escapeHtml(project.name)}</div>
        <div class="project-item-meta">${runningCount}/${project.services.length} running</div>
      `;
      item.addEventListener("click", () => {
        state.selectedProjectId = project.id;
        selectedService(project);
        render();
        openSelectedServiceTerminal().catch((error) => {
          alert(error.message || "Failed to open terminal");
        });
        refreshSelectedServiceHistory().catch(() => {
          // keep UI usable even if history refresh fails
        });
      });
      projectsEl.appendChild(item);
    }
  }

  function renderProjectPanel() {
    const project = selectedProject();
    if (!project) {
      projectHeaderEl.innerHTML = "<div class='project-title'>No project selected</div>";
      commandBarEl.innerHTML = "<div class='command-empty'>Select a project to start.</div>";
      return;
    }

    projectHeaderEl.innerHTML = "";
    const left = document.createElement("div");
    left.innerHTML = `
      <h2 class="project-title">${escapeHtml(project.name)}</h2>
      <div class="project-subtitle">${escapeHtml(project.root)}</div>
    `;

    const right = document.createElement("div");
    right.className = "service-actions";
    const configureBtn = document.createElement("button");
    configureBtn.className = "btn-soft";
    configureBtn.textContent = "Configure";
    configureBtn.addEventListener("click", async () => {
      await configureProject(project);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      const shouldRemove = window.confirm(`Remove ${project.name} from Devrun list?`);
      if (!shouldRemove) {
        return;
      }
      try {
        await api.removeProject(project.id);
        await refreshState();
      } catch (error) {
        alert(error.message || "Failed to remove project");
      }
    });
    right.appendChild(configureBtn);
    right.appendChild(removeBtn);

    projectHeaderEl.appendChild(left);
    projectHeaderEl.appendChild(right);

    if (project.configError) {
      commandBarEl.innerHTML = `
        <div class="command-empty">
          <div class="command-empty-title">Project not configured</div>
          <div class="command-empty-subtitle">${escapeHtml(project.configPath)}</div>
          <div class="error">${escapeHtml(project.configError)}</div>
        </div>
      `;
      return;
    }

    if (!project.services.length) {
      commandBarEl.innerHTML =
        "<div class='command-empty'>No services configured yet. Click Configure.</div>";
      return;
    }

    const service = selectedService(project);
    if (!service) {
      commandBarEl.innerHTML =
        "<div class='command-empty'>No services configured yet. Click Configure.</div>";
      return;
    }

    commandBarEl.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "command-bar-inner";

    const leftControls = document.createElement("div");
    leftControls.className = "command-left";
    leftControls.innerHTML = `
      <div class="command-service-name">Service: ${escapeHtml(service.name)}</div>
    `;

    const commandMeta = document.createElement("div");
    commandMeta.className = "command-meta";
    commandMeta.innerHTML = `
      <span class="command-status ${service.running ? "status-running" : "status-stopped"}">
        ${service.running ? "running" : "stopped"}
      </span>
      <code class="command-preview">${escapeHtml(service.cmd)}</code>
    `;

    leftControls.appendChild(commandMeta);

    const actions = document.createElement("div");
    actions.className = "command-actions";
    const startBtn = makeButton("Start", "btn-primary", () => {
      const currentProject = getProject(project.id) || project;
      const currentService = selectedService(currentProject);
      if (currentService) {
        onAction("start", currentProject, currentService);
      }
    });
    const stopBtn = makeButton("Stop", "btn-danger", () => {
      const currentProject = getProject(project.id) || project;
      const currentService = selectedService(currentProject);
      if (currentService) {
        onAction("stop", currentProject, currentService);
      }
    });
    const restartBtn = makeButton("Restart", "btn-soft", () => {
      const currentProject = getProject(project.id) || project;
      const currentService = selectedService(currentProject);
      if (currentService) {
        onAction("restart", currentProject, currentService);
      }
    });

    startBtn.id = "cmd-start-btn";
    stopBtn.id = "cmd-stop-btn";
    restartBtn.id = "cmd-restart-btn";

    actions.appendChild(startBtn);
    actions.appendChild(stopBtn);
    actions.appendChild(restartBtn);

    bar.appendChild(leftControls);
    bar.appendChild(actions);
    commandBarEl.appendChild(bar);
  }

  function renderTerminalTabs() {
    terminalTabsEl.innerHTML = "";
    const project = selectedProject();
    if (!project) {
      terminalStackEl.innerHTML = '<div class="terminal-empty">Select a project to open a terminal.</div>';
      return;
    }

    if (project.configError || !project.services.length) {
      terminalStackEl.innerHTML = '<div class="terminal-empty">Configure a service to open a terminal.</div>';
      return;
    }

    const activeService = selectedService(project);
    for (const service of project.services) {
      const key = serviceKey(project.id, service.name);
      const entry = state.terminals.get(key);
      const connectionState = entry
        ? entry.connectionState
        : service.running
          ? "live"
          : "stopped";
      const tab = document.createElement("button");
      tab.className = `terminal-tab ${activeService?.name === service.name ? "active" : ""}`;
      const label = stateLabelByKey[connectionState] || connectionState;
      tab.innerHTML = `
        <span class="terminal-tab-title">${escapeHtml(service.name)}</span>
        <span class="terminal-tab-status terminal-tab-status-${connectionState}">${escapeHtml(label)}</span>
      `;
      tab.addEventListener("click", () => {
        state.selectedProjectId = project.id;
        state.selectedServiceByProject.set(project.id, service.name);
        state.activeTerminalKey = key;
        render();
        openSelectedServiceTerminal().catch((error) => {
          alert(error.message || "Failed to open terminal");
        });
        refreshSelectedServiceHistory().catch(() => {
          // keep UI usable even if history refresh fails
        });
      });

      terminalTabsEl.appendChild(tab);
    }

    if (activeService) {
      state.activeTerminalKey = serviceKey(project.id, activeService.name);
    }
    renderTerminalViews();
  }

  function renderTerminalViews() {
    for (const entry of state.terminals.values()) {
      entry.container.classList.toggle("active", entry.key === state.activeTerminalKey);
    }

    for (const entry of state.terminals.values()) {
      if (entry.key === state.activeTerminalKey) {
        entry.fitAddon.fit();
        sendResize(entry);
      }
    }
  }

  async function onAction(action, project, service) {
    try {
      await api.processAction(action, project.id, service.name);
      await refreshState();

      const currentProject = getProject(project.id) || project;
      const currentService = getService(project.id, service.name) || service;

      if (action === "start" || action === "restart") {
        await openTerminal(currentProject, currentService, {
          forceReconnect: true,
          freshRun: true,
          showSeparator: true,
        });
      }

      if (action === "stop") {
        const key = serviceKey(project.id, service.name);
        if (state.terminals.has(key)) {
          await openTerminal(currentProject, currentService, {
            forceReconnect: false,
            freshRun: false,
            showSeparator: false,
          });
        }
      }
    } catch (error) {
      alert(error.message || `Failed to ${action} service`);
    }
  }

  async function configureProject(project) {
    const nameInput = window.prompt(
      "Display name (optional):",
      project.name || "",
    );
    if (nameInput === null) {
      return;
    }

    const services = [];
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
          alert("At least one service is required.");
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
        alert("Command cannot be empty.");
        continue;
      }

      const cwdInput = window.prompt(
        `Working directory for '${serviceName}' (optional, relative to project root):`,
        existing.cwd || "",
      );
      const cwd = (cwdInput || "").trim();

      const nextService = { name: serviceName, cmd };
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
        alert("Default service must match one configured service.");
        return;
      }

      await api.setProjectConfig(
        project.id,
        nameInput.trim() || undefined,
        services,
        defaultMatch.name,
      );
      await refreshState();
    } catch (error) {
      alert(error.message || "Failed to save project config");
    }
  }

  function sendResize(entry) {
    if (!entry || !entry.socket || entry.socket.readyState !== WebSocket.OPEN) {
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

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function render() {
    renderProjects();
    renderProjectPanel();
    renderTerminalTabs();
    renderHistoryPanel();
  }

  async function refreshState() {
    const next = await api.state();
    state.projects = next.projects || [];
    ensureSelectedProject();
    ensureSelectedServices();
    syncTerminalEntries();
    render();

    const project = selectedProject();
    const service = selectedService(project);
    if (project && service) {
      const key = serviceKey(project.id, service.name);
      if (!state.terminals.has(key)) {
        openSelectedServiceTerminal().catch(() => {
          // best effort; keep UI responsive during polling
        });
      }
    }

    await refreshSelectedServiceHistory();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  addProjectBtn.addEventListener("click", async () => {
    const root = window.prompt("Project root path (absolute or relative):");
    if (!root) {
      return;
    }

    const name = window.prompt("Display name (optional):") || undefined;
    try {
      await api.addProject(root, name);
      await refreshState();
    } catch (error) {
      alert(error.message || "Failed to add project");
    }
  });

  async function init() {
    await refreshState();
    await openSelectedServiceTerminal();
    state.pollHandle = window.setInterval(() => {
      refreshState().catch(() => {
        // keep current UI if polling fails
      });
    }, 2000);
  }

  init().catch((error) => {
    console.error(error);
    alert(error.message || "Failed to initialize app");
  });
})();
