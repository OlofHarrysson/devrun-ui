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
    <aside
      id="history-panel"
      className="grid min-h-[320px] grid-rows-[auto_1fr] overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm"
    >
      {shouldShowEmptyState ? (
        <>
          <div className="history-header flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2.5">
            <div className="history-title text-xs font-bold uppercase tracking-[0.08em] text-base-content/70">
              History
            </div>
          </div>
          <div className="history-empty p-3 text-sm text-base-content/60">
            Select a configured service to view history.
          </div>
        </>
      ) : (
        <>
          <div className="history-header flex items-center justify-between gap-2 border-b border-base-300 px-3 py-2.5">
            <div className="history-title text-xs font-bold uppercase tracking-[0.08em]">
              History
            </div>
            <div className="history-meta max-w-[180px] truncate text-[0.69rem] text-base-content/65">
              {selectedService.name} • {historyEvents.length} events
            </div>
          </div>
          <div className="history-list grid content-start gap-2 overflow-auto p-2">
            {selectedHistoryEntry?.loading && !historyItems.length ? (
              <div className="history-empty p-3 text-sm text-base-content/60">Loading history…</div>
            ) : selectedHistoryEntry?.error && !historyItems.length ? (
              <div className="history-empty p-3 text-sm text-error">{selectedHistoryEntry.error}</div>
            ) : !historyItems.length ? (
              <div className="history-empty p-3 text-sm text-base-content/60">
                No events yet for this service.
              </div>
            ) : (
              historyItems.map((event) => {
                const run = shortRunId(event.runId);
                return (
                  <div
                    key={event.seq}
                    className="history-item grid gap-1.5 rounded-box border border-base-300 bg-base-200/55 px-2.5 py-2"
                  >
                    <div className="history-item-top flex min-w-0 items-center gap-1.5">
                      <span className="history-time font-mono text-[0.65rem] text-base-content/65">
                        {formatHistoryTime(event.ts)}
                      </span>
                      <span
                        className={`history-type text-[0.64rem] uppercase ${historyTypeBadgeClass(event.type)}`}
                      >
                        {historyEventLabel(event.type)}
                      </span>
                      {run ? (
                        <span className="history-run ml-auto font-mono text-[0.64rem] text-base-content/65">
                          run {run}
                        </span>
                      ) : null}
                    </div>
                    <div className="history-summary truncate font-mono text-[0.73rem] text-base-content/85">
                      {historyEventSummary(event)}
                    </div>
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
