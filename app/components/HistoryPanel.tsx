import {
  formatHistoryTime,
  historyEventLabel,
  historyEventSummary,
  historyTypeBadgeClass,
  shortRunId,
} from "../lib/devrunUtils";
import type {
  HistoryEntry,
  HistoryEvent,
  ProjectServiceState,
  ProjectState,
} from "../types";

interface HistoryPanelProps {
  selectedProject: ProjectState | null;
  selectedService: ProjectServiceState | null;
  selectedHistoryEntry: HistoryEntry | null;
  historyEvents: HistoryEvent[];
  historyItems: HistoryEvent[];
}

export function HistoryPanel({
  selectedProject,
  selectedService,
  selectedHistoryEntry,
  historyEvents,
  historyItems,
}: HistoryPanelProps) {
  const shouldShowEmptyState =
    !selectedProject ||
    !selectedService ||
    Boolean(selectedProject.configError) ||
    !selectedProject.services.length;

  return (
    <aside id="history-panel" className="history-panel">
      {shouldShowEmptyState ? (
        <>
          <div className="history-header">
            <div className="history-title text-base-content/70">History</div>
          </div>
          <div className="history-empty text-base-content/60">
            Select a configured service to view history.
          </div>
        </>
      ) : (
        <>
          <div className="history-header">
            <div className="history-title">History</div>
            <div className="history-meta">
              {selectedService.name} • {historyEvents.length} events
            </div>
          </div>
          <div className="history-list">
            {selectedHistoryEntry?.loading && !historyItems.length ? (
              <div className="history-empty text-base-content/60">Loading history…</div>
            ) : selectedHistoryEntry?.error && !historyItems.length ? (
              <div className="history-empty text-error">{selectedHistoryEntry.error}</div>
            ) : !historyItems.length ? (
              <div className="history-empty text-base-content/60">
                No events yet for this service.
              </div>
            ) : (
              historyItems.map((event) => {
                const run = shortRunId(event.runId);
                return (
                  <div key={event.seq} className="history-item">
                    <div className="history-item-top">
                      <span className="history-time">{formatHistoryTime(event.ts)}</span>
                      <span className={`history-type ${historyTypeBadgeClass(event.type)}`}>
                        {historyEventLabel(event.type)}
                      </span>
                      {run ? <span className="history-run">run {run}</span> : null}
                    </div>
                    <div className="history-summary">{historyEventSummary(event)}</div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
}
