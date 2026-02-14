(() => {
  const state = {
    projects: [],
    selectedProjectId: null,
    terminals: new Map(),
    activeTerminalKey: null,
    pollHandle: null,
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
  };

  function serviceKey(projectId, serviceName) {
    return `${projectId}::${serviceName}`;
  }

  function selectedProject() {
    return state.projects.find((project) => project.id === state.selectedProjectId) || null;
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
    right.appendChild(removeBtn);

    projectHeaderEl.appendChild(left);
    projectHeaderEl.appendChild(right);

    if (project.configError) {
      projectServicesEl.innerHTML = `
        <div class="service-row">
          <div>
            <div class="service-name">Missing/invalid config</div>
            <div class="service-cmd">${escapeHtml(project.configPath)}</div>
            <div class="error">${escapeHtml(project.configError)}</div>
          </div>
        </div>
      `;
      return;
    }

    if (!project.services.length) {
      projectServicesEl.innerHTML = "<div class='service-row'>No services in config.</div>";
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
      const openBtn = makeButton("Terminal", "btn-soft", () => openTerminal(project, service));

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
      tab.textContent = `${entry.projectName} / ${entry.serviceName}`;
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
      if (action === "start" || action === "restart") {
        openTerminal(project, service);
      }
      await refreshState();
    } catch (error) {
      alert(error.message || `Failed to ${action} service`);
    }
  }

  function openTerminal(project, service) {
    const key = serviceKey(project.id, service.name);
    const existing = state.terminals.get(key);
    if (existing) {
      state.activeTerminalKey = key;
      renderTerminalTabs();
      return;
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

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws?projectId=${encodeURIComponent(project.id)}&serviceName=${encodeURIComponent(service.name)}`;
    const socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      sendResize({ socket, term, fitAddon, key });
      term.focus();
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "output" && typeof message.data === "string") {
          term.write(message.data);
        }
        if (message.type === "error" && message.error) {
          term.writeln(`\r\n[error] ${message.error}`);
        }
      } catch {
        // ignore malformed ws output
      }
    });

    socket.addEventListener("close", () => {
      term.writeln("\r\n[terminal disconnected]");
    });

    term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const entry = {
      key,
      projectId: project.id,
      projectName: project.name,
      serviceName: service.name,
      term,
      fitAddon,
      socket,
      container,
    };

    state.terminals.set(key, entry);
    state.activeTerminalKey = key;
    renderTerminalTabs();

    window.addEventListener("resize", () => {
      if (!state.terminals.has(key)) {
        return;
      }
      fitAddon.fit();
      sendResize(entry);
    });
  }

  function sendResize(entry) {
    if (!entry || entry.socket.readyState !== WebSocket.OPEN) {
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
