import type { ProjectState } from "../types";

interface ProjectHeaderProps {
  selectedProject: ProjectState | null;
  onConfigureProject: (project: ProjectState) => Promise<void>;
  onRemoveProject: (project: ProjectState) => Promise<void>;
}

export function ProjectHeader({
  selectedProject,
  onConfigureProject,
  onRemoveProject,
}: ProjectHeaderProps) {
  return (
    <div
      id="project-header"
      className="flex items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-sm md:p-3.5"
    >
      {!selectedProject ? (
        <div className="text-xl leading-tight text-base-content/70">No project selected</div>
      ) : (
        <>
          <div>
            <h2 className="m-0 text-xl leading-tight">{selectedProject.name}</h2>
            <div className="mt-1 max-w-full truncate font-mono text-xs text-base-content/70">
              {selectedProject.root}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                void onConfigureProject(selectedProject);
              }}
            >
              Configure
            </button>
            <button
              className="btn btn-sm btn-error btn-outline"
              onClick={() => {
                void onRemoveProject(selectedProject);
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
