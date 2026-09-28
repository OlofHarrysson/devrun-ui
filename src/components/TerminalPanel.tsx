import { useRef, useState } from "react";
import { serviceKey, stateLabelByKey } from "../lib/devrunUtils";
import type { ConnectionState, HistoryEntry, HistoryEvent, ProjectServiceState, ProjectState } from "../types/ui";
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
  selectedProject, selectedService, terminalKeys, activeTerminalKey,
  terminalEmptyMessage, selectedHistoryEntry, historyEvents, historyItems,
  getServiceConnectionState, onSelectService, attachTerminalContainer,
}: TerminalPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyToggle = useRef<HTMLButtonElement>(null);
  function closeHistory() { setHistoryOpen(false); historyToggle.current?.focus(); }

  return (
    <section className="terminal-panel" aria-label="Service output">
      <div className="terminal-toolbar">
        <div id="terminal-tabs" aria-label="Services">
          {selectedProject && !selectedProject.configError ? selectedProject.services.map((service) => {
            const key = serviceKey(selectedProject.id, service.name);
            const connection = getServiceConnectionState(selectedProject, service);
            const active = selectedService?.name === service.name;
            return (
              <button key={key} type="button" className={`terminal-tab${active ? " active" : ""}`}
                aria-pressed={active} onClick={() => { void onSelectService(service.name); }}>
                <span className="terminal-tab-title" title={service.name}>{service.name}</span>
                <span className="terminal-tab-status" data-state={connection}>{service.running && !terminalKeys.includes(key) ? "not attached" : stateLabelByKey[connection]}</span>
              </button>
            );
          }) : null}
        </div>
        <button ref={historyToggle} id="history-toggle" type="button" className="history-toggle"
          aria-expanded={historyOpen} aria-controls="history-drawer" onClick={() => setHistoryOpen(!historyOpen)}>History</button>
      </div>
      <div className={`output-layout${historyOpen ? " with-history" : ""}`}>
        <div id="terminal-stack">
          {terminalEmptyMessage && <div className="terminal-empty">{terminalEmptyMessage}</div>}
          {terminalKeys.map((key) => (
            <div key={key} className={`terminal-view${activeTerminalKey === key ? "" : " hidden"}`}
              ref={(node) => { attachTerminalContainer(key, node); }} />
          ))}
        </div>
        <div id="history-drawer" className="history-drawer" hidden={!historyOpen}
          onKeyDown={(event) => { if (event.key === "Escape") closeHistory(); }}>
          <button type="button" className="history-close" aria-label="Close history" onClick={closeHistory}>Close</button>
          <HistoryPanel selectedProject={selectedProject} selectedService={selectedService}
            selectedHistoryEntry={selectedHistoryEntry} historyEvents={historyEvents} historyItems={historyItems} />
        </div>
      </div>
    </section>
  );
}
