import {
  connectionBadgeClass,
  serviceKey,
  stateLabelByKey,
} from "../lib/devrunUtils";
import type {
  ConnectionState,
  HistoryEntry,
  HistoryEvent,
  ProjectServiceState,
  ProjectState,
} from "../types";
import { HistoryPanel } from "./HistoryPanel";

interface TerminalPanelProps {
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  terminalKeys: string[];
  activeTerminalKey: string | null;
  terminalEmptyMessage: string;
  selectedHistoryEntry: HistoryEntry | null;
  historyEvents: HistoryEvent[];
  historyItems: HistoryEvent[];
  getServiceConnectionState: (
    project: ProjectState,
    service: ProjectServiceState,
  ) => ConnectionState;
  onSelectService: (serviceName: string) => Promise<void>;
  attachTerminalContainer: (key: string, node: HTMLDivElement | null) => void;
}

export function TerminalPanel({
  selectedProject,
  selectedService,
  terminalKeys,
  activeTerminalKey,
  terminalEmptyMessage,
  selectedHistoryEntry,
  historyEvents,
  historyItems,
  getServiceConnectionState,
  onSelectService,
  attachTerminalContainer,
}: TerminalPanelProps) {
  return (
    <section className="terminal-panel">
      <div id="terminal-tabs" className="terminal-tabs">
        {selectedProject && !selectedProject.configError && selectedProject.services.length
          ? selectedProject.services.map((service) => {
              const key = serviceKey(selectedProject.id, service.name);
              const connectionState = getServiceConnectionState(selectedProject, service);
              const label = stateLabelByKey[connectionState] || connectionState;
              const isActive = selectedService?.name === service.name;

              return (
                <button
                  key={key}
                  className={`terminal-tab btn btn-sm normal-case justify-between min-h-0 ${
                    isActive
                      ? "active btn-primary text-primary-content"
                      : "btn-ghost border border-base-300"
                  }`}
                  onClick={() => {
                    void onSelectService(service.name);
                  }}
                >
                  <span className="terminal-tab-title">{service.name}</span>
                  <span className={`terminal-tab-status ${connectionBadgeClass(connectionState)}`}>
                    {label}
                  </span>
                </button>
              );
            })
          : null}
      </div>

      <div className="terminal-workspace">
        <div id="terminal-stack" className="terminal-stack">
          {terminalEmptyMessage ? (
            <div className="terminal-empty text-base-content/60">{terminalEmptyMessage}</div>
          ) : null}
          {terminalKeys.map((key) => (
            <div
              key={key}
              className={`terminal-view ${activeTerminalKey === key ? "active" : ""}`}
              ref={(node) => {
                attachTerminalContainer(key, node);
              }}
            />
          ))}
        </div>

        <HistoryPanel
          selectedProject={selectedProject}
          selectedService={selectedService}
          selectedHistoryEntry={selectedHistoryEntry}
          historyEvents={historyEvents}
          historyItems={historyItems}
        />
      </div>
    </section>
  );
}
