import { useCallback, useEffect, useRef, useState } from "react";
import { devrunApi } from "../lib/devrunApi";
import { serviceKey } from "../lib/devrunUtils";
import { startTime } from "../lib/overview";
import type { ProjectServiceState, ProjectState } from "../types/ui";

type Pending = { action: "start" | "stop"; label: string; requestedAt: number };
const POLL_MS = 2000;
const CONFIRMATION_MS = 20000;

export function useProjectOverview() {
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [metadataError, setMetadataError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const pendingRef = useRef<Record<string, Pending>>({});
  const historyCache = useRef(new Map<string, string | undefined>());
  const refreshing = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback((): Promise<void> => {
    if (refreshing.current) return refreshing.current;
    const task = async () => {
      try {
        const signal = AbortSignal.timeout(5000);
        const response = await devrunApi.state(signal);
        const fetchedAt = Date.now();
        const next = response.projects.map((project) => ({ ...project, services: project.services.map((service) => ({ ...service })) }));
        // Only recover missing stopped-run timestamps; never infer running age from a previous run.
        const missing = next.flatMap((project) => project.services.filter((service) => !service.running && startTime(service.startedAt) === null).map((service) => ({ project, service })));
        let failedMetadata = false;
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
          while (index < missing.length) {
            const { project, service } = missing[index++];
            const key = JSON.stringify([project.id, service.name, service.lastRunId ?? null]);
            if (!historyCache.current.has(key)) {
              try {
                const history = await devrunApi.history(project.id, service.name, 0, 100, signal);
                const starts = (history.events ?? []).filter((event) => event.type === "start" && startTime(event.ts) !== null);
                const latest = starts.sort((a, b) => Date.parse(b.ts!) - Date.parse(a.ts!))[0]?.ts;
                historyCache.current.set(key, latest);
              } catch { failedMetadata = true; }
            }
            service.startedAt = historyCache.current.get(key);
          }
        }));
        if (!mounted.current) return;
        setProjects(next);
        setLoaded(true);
        setError("");
        setMetadataError(failedMetadata);
        setLastUpdated(fetchedAt);
        const remaining = { ...pendingRef.current };
        for (const [key, request] of Object.entries(remaining)) {
          const service = next.flatMap((project) => project.services.map((service) => ({ key: serviceKey(project.id, service.name), service }))).find((entry) => entry.key === key)?.service;
          const confirmed = service && service.running === (request.action === "start");
          if (confirmed) {
            delete remaining[key];
            setNotice(`${request.label} ${request.action === "stop" ? "stopped. Configuration kept for next time." : "started."}`);
          } else if (Date.now() - request.requestedAt > CONFIRMATION_MS) {
            delete remaining[key];
            setActionErrors((errors) => ({ ...errors, [key]: `${request.label}: ${request.action} not confirmed yet. Check its details before trying again.` }));
          }
        }
        pendingRef.current = remaining;
        setPending(remaining);
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : "Cannot reach Terminal Manager");
      }
    };
    refreshing.current = task().finally(() => { refreshing.current = null; });
    return refreshing.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, [refresh]);

  async function act(action: "start" | "stop", project: ProjectState, service: ProjectServiceState) {
    const key = serviceKey(project.id, service.name);
    if (pendingRef.current[key] || error) return;
    pendingRef.current = { ...pendingRef.current, [key]: { action, label: `${project.name} / ${service.name}`, requestedAt: Date.now() } };
    setPending(pendingRef.current);
    setNotice("");
    setActionErrors((errors) => { const next = { ...errors }; delete next[key]; return next; });
    try {
      await devrunApi.processAction(action, project.id, service.name);
      // A poll already in progress may predate the action. Confirm with a fresh fetch.
      if (refreshing.current) await refreshing.current;
      await refresh();
    } catch (cause) {
      if (!mounted.current) return;
      const next = { ...pendingRef.current }; delete next[key]; pendingRef.current = next;
      setPending(next);
      setActionErrors((errors) => ({ ...errors, [key]: `${project.name} / ${service.name}: ${cause instanceof Error ? cause.message : `Failed to ${action}`}` }));
    }
  }

  return { projects, loaded, error, metadataError, lastUpdated, notice, actionErrors, pending, refresh, act };
}
