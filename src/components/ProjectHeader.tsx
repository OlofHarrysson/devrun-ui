import { useRef } from "react";
import type { ProjectState } from "../types/ui";

interface ProjectHeaderProps {
  selectedProject: ProjectState | null;
  onRemoveProject: (project: ProjectState) => Promise<void>;
}

export function ProjectHeader({ selectedProject, onRemoveProject }: ProjectHeaderProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <div id="project-header" className="project-header">
      <div className="project-heading">
        <h2>{selectedProject?.name || "Your local workspace"}</h2>
        {selectedProject && <p title={selectedProject.root}>{selectedProject.root}</p>}
      </div>
      {selectedProject && (
        <details key={selectedProject.id} ref={menu} className="project-menu"
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menu.current) {
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}>
          <summary aria-label="Project actions" title="Project actions">···</summary>
          <div className="project-menu-items">
            <button type="button" onClick={() => {
              if (menu.current) menu.current.open = false;
              void onRemoveProject(selectedProject);
            }}>Remove project</button>
          </div>
        </details>
      )}
    </div>
  );
}
