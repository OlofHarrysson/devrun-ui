import { formatHistoryTime, historyEventLabel, historyEventSummary } from "../lib/devrunUtils";
import type { HistoryEntry, HistoryEvent, ProjectServiceState, ProjectState } from "../types/ui";

interface HistoryPanelProps {
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  selectedHistoryEntry: HistoryEntry | null;
  historyEvents: HistoryEvent[];
  historyItems: HistoryEvent[];
}

export function HistoryPanel({ selectedProject, selectedService, selectedHistoryEntry, historyEvents, historyItems }: HistoryPanelProps) {
  const configured = selectedProject && selectedService && !selectedProject.configError;
  return (
    <aside id="history-panel" aria-label="Service history">
      <div className="history-header">
        <h3>History</h3>
        {configured && <p>{selectedService.name} · {historyEvents.length} events</p>}
      </div>
      <div className="history-list">
        {!configured ? <p className="history-empty">Select a configured service to view history.</p>
          : selectedHistoryEntry?.loading && !historyItems.length ? <p className="history-empty">Loading history…</p>
          : !historyItems.length && !selectedHistoryEntry?.error ? <p className="history-empty">No events yet for this service.</p>
          : historyItems.map((event) => (
            <div className="history-item" key={event.seq}>
              <div className="history-item-top"><span className="history-type">{historyEventLabel(event.type)}</span><time>{formatHistoryTime(event.ts)}</time></div>
              <p className="history-summary">{historyEventSummary(event)}</p>
              {event.runId && <details className="history-run"><summary>Run details</summary><code>{event.runId}</code></details>}
            </div>
          ))}
        {selectedHistoryEntry?.error && <p className="history-error" role="alert">{selectedHistoryEntry.error}</p>}
      </div>
    </aside>
  );
}
