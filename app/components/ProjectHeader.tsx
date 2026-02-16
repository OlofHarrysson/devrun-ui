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
    <div id="project-header" className="project-header">
      {!selectedProject ? (
        <div className="project-title text-base-content/70">No project selected</div>
      ) : (
        <>
          <div>
            <h2 className="project-title">{selectedProject.name}</h2>
            <div className="project-subtitle">{selectedProject.root}</div>
          </div>
          <div className="service-actions">
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
