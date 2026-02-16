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
} from "../types/ui";
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
    <section className="grid min-h-0 grid-rows-[auto_1fr] gap-2">
      <div id="terminal-tabs" className="flex gap-2 overflow-x-auto pb-0.5">
        {selectedProject && !selectedProject.configError && selectedProject.services.length
          ? selectedProject.services.map((service) => {
              const key = serviceKey(selectedProject.id, service.name);
              const connectionState = getServiceConnectionState(selectedProject, service);
              const label = stateLabelByKey[connectionState] || connectionState;
              const isActive = selectedService?.name === service.name;

              return (
                <button
                  key={key}
                  className={`terminal-tab btn btn-sm min-h-0 min-w-[160px] items-center justify-between gap-2 normal-case ${
                    isActive
                      ? "active btn-primary text-primary-content"
                      : "btn-ghost border border-base-300"
                  }`}
                  onClick={() => {
                    void onSelectService(service.name);
                  }}
                >
                  <span className="terminal-tab-title max-w-[180px] truncate text-left">
                    {service.name}
                  </span>
                  <span
                    className={`terminal-tab-status text-[0.65rem] ${connectionBadgeClass(connectionState)}`}
                  >
                    {label}
                  </span>
                </button>
              );
            })
          : null}
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div
          id="terminal-stack"
          className="relative min-h-[320px] overflow-hidden rounded-box border border-neutral/40 bg-neutral shadow-sm"
        >
          {terminalEmptyMessage ? (
            <div className="terminal-empty p-3.5 text-sm text-base-content/60">{terminalEmptyMessage}</div>
          ) : null}
          {terminalKeys.map((key) => (
            <div
              key={key}
              className={`terminal-view absolute inset-0 p-2 ${activeTerminalKey === key ? "block" : "hidden"}`}
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
