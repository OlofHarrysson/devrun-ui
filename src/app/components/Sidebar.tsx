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
    <aside className="flex flex-col gap-3 border-b border-base-300 bg-base-100 p-4 md:min-h-screen md:border-r md:border-b-0">
      <div className="grid gap-2.5">
        <h1 className="m-0 text-xs font-extrabold uppercase tracking-widest text-primary">
          Devrun UI
        </h1>
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
      <div id="projects" className="grid min-h-0 gap-2 overflow-auto">
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
                className={`project-item btn btn-block grid h-auto min-h-0 grid-cols-[1fr_auto] items-start justify-between gap-2 px-3 py-2 normal-case ${
                  isActive
                    ? "active btn-primary text-primary-content"
                    : "btn-ghost border border-base-300"
                }`}
                onClick={() => {
                  void onSelectProject(project);
                }}
              >
                <div className="project-item-name max-w-[175px] truncate text-left font-bold leading-tight">
                  {project.name}
                </div>
                <div className="project-item-meta badge badge-sm badge-ghost self-center text-xs">
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
