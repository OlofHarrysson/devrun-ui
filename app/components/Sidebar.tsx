import type { ProjectState } from "../types";

interface SidebarProps {
  projects: ProjectState[];
  selectedProjectId: string | null;
  onAddProject: () => Promise<void>;
  onSelectProject: (project: ProjectState) => Promise<void>;
}

export function Sidebar({
  projects,
  selectedProjectId,
  onAddProject,
  onSelectProject,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <h1>Devrun UI</h1>
        <button
          id="add-project-btn"
          className="btn btn-primary btn-sm"
          onClick={() => {
            void onAddProject();
          }}
        >
          Add Project
        </button>
      </div>
      <div id="projects" className="projects">
        {!projects.length ? (
          <div className="alert alert-info alert-soft text-sm">
            <span>No projects yet.</span>
          </div>
        ) : (
          projects.map((project) => {
            const runningCount = project.services.filter((service) => service.running).length;
            const isActive = project.id === selectedProjectId;

            return (
              <button
                key={project.id}
                className={`project-item btn btn-block normal-case justify-between h-auto px-3 py-2 min-h-0 ${
                  isActive
                    ? "active btn-primary text-primary-content"
                    : "btn-ghost border border-base-300"
                }`}
                onClick={() => {
                  void onSelectProject(project);
                }}
              >
                <div className="project-item-name">{project.name}</div>
                <div className="project-item-meta badge badge-sm badge-ghost">
                  {runningCount}/{project.services.length} running
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
