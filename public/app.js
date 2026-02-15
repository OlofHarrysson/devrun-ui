(() => {
  const state = {
    projects: [],
    selectedProjectId: null,
    terminals: new Map(),
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
  const projectServicesEl = document.getElementById("project-services");
  const terminalTabsEl = document.getElementById("terminal-tabs");
  const terminalStackEl = document.getElementById("terminal-stack");
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
    async setProjectConfig(projectId, name, services) {
      const response = await fetch("/api/project-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, services }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save project config");
      }
      return response.json();
    },
    async logs(projectId, serviceName, chars = 8000) {
      const query = new URLSearchParams({
        projectId,
        serviceName,
        chars: String(chars),
      });
      const response = await fetch(`/api/logs?${query.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch logs");
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

    closeEntrySocket(entry);
    setEntryReadOnly(entry, true);
    updateEntryStatus(entry, "stopped");

    try {
      const payload = await api.logs(projectId, serviceName, 12_000);
      const output = typeof payload.output === "string" ? payload.output : "";
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
    const url = `${protocol}://${window.location.host}/ws?projectId=${encodeURIComponent(project.id)}&serviceName=${encodeURIComponent(service.name)}&replay=${replay ? "1" : "0"}`;
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
        if (message.type === "output" && typeof message.data === "string") {
          entry.term.write(message.data);
        }

        if (message.type === "error" && message.error) {
          writeNotice(entry, message.error);
        }

        if (message.type === "exited") {
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
      });
      return;
    }

    await loadRecentLogs(entry, project.id, service.name, {
      showBanner: true,
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

      if (!service.running && entry.connectionState === "live") {
        markDisconnected(entry, "service stopped", "stopped");
      }
    }
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
        render();
      });
      projectsEl.appendChild(item);
    }
  }

  function renderProjectPanel() {
    const project = selectedProject();
    if (!project) {
      projectHeaderEl.innerHTML = "<div class='project-title'>No project selected</div>";
      projectServicesEl.innerHTML = "";
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
      projectServicesEl.innerHTML = `
        <div class="service-row">
          <div>
            <div class="service-name">Project not configured</div>
            <div class="service-cmd">${escapeHtml(project.configPath)}</div>
            <div class="error">${escapeHtml(project.configError)}</div>
          </div>
        </div>
      `;
      return;
    }

    if (!project.services.length) {
      projectServicesEl.innerHTML =
        "<div class='service-row'>No services configured yet. Click Configure.</div>";
      return;
    }

    projectServicesEl.innerHTML = "";
    for (const service of project.services) {
      const row = document.createElement("div");
      row.className = "service-row";
      row.innerHTML = `
        <div>
          <div class="service-name">${escapeHtml(service.name)}
            <span class="${service.running ? "status-running" : "status-stopped"}">
              ${service.running ? "running" : "stopped"}
            </span>
          </div>
          <div class="service-cmd">${escapeHtml(service.cmd)}</div>
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "service-actions";

      const startBtn = makeButton("Play", "btn-primary", () => onAction("start", project, service));
      const stopBtn = makeButton("Stop", "btn-danger", () => onAction("stop", project, service));
      const restartBtn = makeButton("Restart", "btn-soft", () => onAction("restart", project, service));
      const openBtn = makeButton("Terminal", "btn-soft", () => {
        openTerminal(project, service, {
          forceReconnect: false,
          freshRun: false,
          showSeparator: false,
        }).catch((error) => {
          alert(error.message || "Failed to open terminal");
        });
      });

      actions.appendChild(startBtn);
      actions.appendChild(stopBtn);
      actions.appendChild(restartBtn);
      actions.appendChild(openBtn);

      row.appendChild(actions);
      projectServicesEl.appendChild(row);
    }
  }

  function renderTerminalTabs() {
    terminalTabsEl.innerHTML = "";
    const entries = Array.from(state.terminals.values());

    if (!entries.length) {
      terminalTabsEl.innerHTML = "";
      terminalStackEl.innerHTML = '<div class="terminal-empty">Start a service and open a terminal.</div>';
      return;
    }

    for (const entry of entries) {
      const tab = document.createElement("button");
      tab.className = `terminal-tab ${entry.key === state.activeTerminalKey ? "active" : ""}`;
      const label = stateLabelByKey[entry.connectionState] || entry.connectionState;
      tab.innerHTML = `
        <span class="terminal-tab-title">${escapeHtml(entry.projectName)} / ${escapeHtml(entry.serviceName)}</span>
        <span class="terminal-tab-status terminal-tab-status-${entry.connectionState}">${escapeHtml(label)}</span>
      `;
      tab.addEventListener("click", () => {
        state.activeTerminalKey = entry.key;
        renderTerminalViews();
      });

      terminalTabsEl.appendChild(tab);
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
      await api.setProjectConfig(
        project.id,
        nameInput.trim() || undefined,
        services,
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
  }

  async function refreshState() {
    const next = await api.state();
    state.projects = next.projects || [];
    ensureSelectedProject();
    syncTerminalEntries();
    render();
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
