import {
  lifecycleBadgeClass,
  serviceLifecycleStatus,
} from "../lib/devrunUtils";
import type {
  ProcessAction,
  ProjectServiceState,
  ProjectState,
} from "../types/ui";

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
    <div
      id="command-bar"
      className="rounded-box border border-base-300 bg-base-100 p-3 shadow-sm md:p-3.5"
    >
      {!selectedProject ? (
        <div className="alert alert-info alert-soft grid gap-1 text-sm">
          Select a project to start.
        </div>
      ) : selectedProject.configError ? (
        <div className="alert alert-warning alert-soft grid gap-1">
          <div className="text-sm font-bold">Project not configured</div>
          <div className="font-mono text-xs text-base-content/70">{selectedProject.configPath}</div>
          <div className="text-xs text-error">{selectedProject.configError}</div>
        </div>
      ) : !selectedProject.services.length || !selectedService ? (
        <div className="alert alert-info alert-soft grid gap-1 text-sm">
          No services configured yet. Click Configure.
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid min-w-[300px] max-w-full gap-2">
            <div className="text-xs font-semibold text-base-content/80">
              Service: {selectedService.name}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`lowercase font-bold ${lifecycleBadgeClass(
                  serviceLifecycleStatus(selectedService),
                )}`}
              >
                {serviceLifecycleStatus(selectedService)}
              </span>
              <code className="inline-block max-w-full truncate rounded-full border border-base-300 bg-base-200 px-2.5 py-1 font-mono text-xs text-base-content/80 sm:max-w-[76ch]">
                {selectedService.cmd}
              </code>
              <span className="badge badge-sm badge-outline font-mono">
                port: {typeof selectedService.port === "number" ? selectedService.port : "auto"}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
