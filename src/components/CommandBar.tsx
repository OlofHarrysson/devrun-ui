import { useState } from "react";
import { serviceLifecycleStatus } from "../lib/devrunUtils";
import type { ProcessAction, ProjectServiceState, ProjectState } from "../types/ui";

interface CommandBarProps {
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  onOpenLog?: (project: ProjectState, service: ProjectServiceState) => Promise<void>;
  onAction: (action: ProcessAction, project: ProjectState, service: ProjectServiceState) => Promise<void>;
}

export function CommandBar({ selectedProject, selectedService, onOpenLog, onAction }: CommandBarProps) {
  const [pending, setPending] = useState<ProcessAction | null>(null);
  const status = serviceLifecycleStatus(selectedService);
  const openAppUrl = selectedService?.running && status === "ready" ? selectedService.effectiveUrl : null;

  async function act(action: ProcessAction) {
    if (!selectedProject || !selectedService || pending) return;
    setPending(action);
    try { await onAction(action, selectedProject, selectedService); }
    finally { setPending(null); }
  }

  return (
    <div id="command-bar" className="command-bar">
      {!selectedProject ? (
        <div className="setup-message"><strong>Bring your projects here.</strong><p>Ask your agent to register a project and configure its services in Devrun.</p></div>
      ) : selectedProject.configError ? (
        <div className="setup-message" role="alert"><strong>Project not configured</strong><p>{selectedProject.configError}</p><p>Ask your agent to update this project’s service configuration.</p></div>
      ) : !selectedService ? (
        <div className="setup-message"><strong>No services configured yet.</strong><p>Ask your agent to configure a service for this project.</p></div>
      ) : (
        <>
          <div className="service-controls">
            <div className="service-context">
              <span className={`service-status${status === "ready" ? " badge-success" : ""}`} data-state={status}>
                <span className="status-dot" aria-hidden="true" />{status}
              </span>
              <code className="service-command" title={selectedService.cmd}>{selectedService.cmd}</code>
              {typeof selectedService.port === "number" && <span className="service-port">:{selectedService.port}</span>}
            </div>
            <div className="service-actions" aria-label="Service actions" aria-busy={Boolean(pending)}>
              {openAppUrl && <a id="cmd-open-app-link" className="btn btn-sm btn-primary" href={openAppUrl} target="_blank" rel="noreferrer">Open app <span aria-hidden="true">↗</span></a>}
              {!selectedService.running ? (
                <button id="cmd-start-btn" type="button" className="btn btn-sm btn-primary" disabled={Boolean(pending)} onClick={() => { void act("start"); }}>{pending === "start" ? "Starting…" : "Start"}</button>
              ) : (
                <>
                  <button id="cmd-restart-btn" type="button" className="btn btn-sm btn-outline" disabled={Boolean(pending)} onClick={() => { void act("restart"); }}>{pending === "restart" ? "Restarting…" : "Restart"}</button>
                  <button id="cmd-stop-btn" type="button" className="btn btn-sm btn-ghost" disabled={Boolean(pending)} onClick={() => { void act("stop"); }}>{pending === "stop" ? "Stopping…" : "Stop"}</button>
                </>
              )}
              <details key={`${selectedProject.id}/${selectedService.name}`} className="service-details"
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}>
                <summary>Details</summary>
                <div className="service-details-content">
                  <dl>
                    <div><dt>Command</dt><dd><code>{selectedService.cmd}</code></dd></div>
                    <div><dt>Directory</dt><dd><code>{selectedService.cwd || selectedProject.root}</code></dd></div>
                    {selectedService.requestedPort !== undefined && <div><dt>Preferred port</dt><dd>{selectedService.requestedPort}</dd></div>}
                    {(selectedService.runId || selectedService.lastRunId) && <div><dt>Run</dt><dd><code>{selectedService.runId || selectedService.lastRunId}</code></dd></div>}
                    {selectedService.logFilePath && <div><dt>Log file</dt><dd><code>{selectedService.logFilePath}</code></dd></div>}
                  </dl>
                  {selectedService.logFilePath && onOpenLog && <button id="cmd-open-log-btn" className="btn btn-sm btn-outline" onClick={() => { void onOpenLog(selectedProject, selectedService); }}>Open log</button>}
                </div>
              </details>
            </div>
          </div>
          {status === "error" && <p className="service-error" role="alert">Service failed. Check the output before starting it again.</p>}
        </>
      )}
    </div>
  );
}
