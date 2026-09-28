import { useState } from "react";
import type { ProjectState } from "../types/ui";

interface SidebarProps {
  projects: ProjectState[];
  selectedProjectId: string | null;
  onSelectProject: (project: ProjectState) => Promise<void>;
}

function projectStatus(project: ProjectState) {
  if (project.configError || project.services.some((service) => service.status === "error")) {
    return { label: "Needs attention", state: "error" };
  }
  const running = project.services.filter((service) => service.running);
  if (running.some((service) => service.status === "starting" || service.ready === false)) {
    return { label: "Starting", state: "starting" };
  }
  return running.length
    ? { label: `${running.length} running`, state: "ready" }
    : { label: "Stopped", state: "stopped" };
}

export function Sidebar({ projects, selectedProjectId, onSelectProject }: SidebarProps) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const visibleProjects = projects.filter((project) => `${project.name} ${project.root}`.toLowerCase().includes(search));
  const running = projects.filter((project) => project.services.some((service) => service.running)).length;

  return (
    <aside className="workspace-sidebar" aria-label="Projects">
      <div className="sidebar-identity">
        <h1>Terminal Manager<span aria-hidden="true" className="brand-dot" /></h1>
        <p>{running} active · {projects.length} projects</p>
      </div>
      <label className="project-search">
        <span className="sr-only">Search projects</span>
        <input type="search" placeholder="Find a project…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="mobile-project-picker">
        <span className="sr-only">Choose project</span>
        <select aria-label="Choose project" value={selectedProjectId || ""} disabled={!projects.length}
          onChange={(event) => {
            const project = projects.find((entry) => entry.id === event.target.value);
            if (project) void onSelectProject(project);
          }}>
          {!projects.length && <option value="">No projects yet</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {projectStatus(project).label}</option>)}
        </select>
      </label>
      <nav id="projects" className="project-list" aria-label="Project list">
        {!projects.length ? <p className="sidebar-empty">No projects yet.</p>
          : !visibleProjects.length ? <p className="sidebar-empty">No matching projects.</p>
          : visibleProjects.map((project) => {
            const status = projectStatus(project);
            const active = project.id === selectedProjectId;
            return (
              <button key={project.id} type="button" aria-pressed={active}
                className={`project-item${active ? " active" : ""}`}
                title={`${project.name}\n${project.root}`}
                onClick={() => { void onSelectProject(project); }}>
                <span className="project-item-name">{project.name}</span>
                <span className="project-item-meta" data-state={status.state}>
                  <span className="status-dot" aria-hidden="true" />{status.label}
                </span>
              </button>
            );
          })}
      </nav>
    </aside>
  );
}
