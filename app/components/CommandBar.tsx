import {
  lifecycleBadgeClass,
  serviceLifecycleStatus,
} from "../lib/devrunUtils";
import type {
  ProcessAction,
  ProjectServiceState,
  ProjectState,
} from "../types";

interface CommandBarProps {
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  onAction: (
    action: ProcessAction,
    project: ProjectState,
    service: ProjectServiceState,
  ) => Promise<void>;
}

export function CommandBar({
  selectedProject,
  selectedService,
  onAction,
}: CommandBarProps) {
  return (
    <div id="command-bar" className="command-bar">
      {!selectedProject ? (
        <div className="command-empty alert alert-info alert-soft text-sm">
          Select a project to start.
        </div>
      ) : selectedProject.configError ? (
        <div className="command-empty alert alert-warning alert-soft">
          <div className="command-empty-title">Project not configured</div>
          <div className="command-empty-subtitle">{selectedProject.configPath}</div>
          <div className="error">{selectedProject.configError}</div>
        </div>
      ) : !selectedProject.services.length || !selectedService ? (
        <div className="command-empty alert alert-info alert-soft text-sm">
          No services configured yet. Click Configure.
        </div>
      ) : (
        <div className="command-bar-inner">
          <div className="command-left">
            <div className="command-service-name">Service: {selectedService.name}</div>
            <div className="command-meta">
              <span
                className={`command-status ${lifecycleBadgeClass(
                  serviceLifecycleStatus(selectedService),
                )}`}
              >
                {serviceLifecycleStatus(selectedService)}
              </span>
              <code className="command-preview">{selectedService.cmd}</code>
            </div>
          </div>

          <div className="command-actions">
            <button
              id="cmd-start-btn"
              className="btn btn-sm btn-primary"
              onClick={() => {
                void onAction("start", selectedProject, selectedService);
              }}
            >
              Start
            </button>
            <button
              id="cmd-stop-btn"
              className="btn btn-sm btn-error btn-outline"
              onClick={() => {
                void onAction("stop", selectedProject, selectedService);
              }}
            >
              Stop
            </button>
            <button
              id="cmd-restart-btn"
              className="btn btn-sm btn-secondary btn-outline"
              onClick={() => {
                void onAction("restart", selectedProject, selectedService);
              }}
            >
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
