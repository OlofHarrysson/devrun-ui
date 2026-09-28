"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectOverview } from "../hooks/useProjectOverview";
import { serviceKey, serviceLifecycleStatus } from "../lib/devrunUtils";
import { elapsed, projectHref, projectTime, startTime } from "../lib/overview";

export default function HomePage() {
  const app = useProjectOverview();
  const [filter, setFilter] = useState<"all" | "running">("running");
  const [sort, setSort] = useState<"recent" | "longest">("recent");
  const [query, setQuery] = useState("");
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const now = app.lastUpdated ?? Date.now();
  const runningServices = app.projects.reduce((count, project) => count + project.services.filter((service) => service.running).length, 0);
  const runningProjects = app.projects.filter((project) => project.services.some((service) => service.running)).length;
  const visible = app.projects.filter((project) => (filter === "all" || project.services.some((service) => service.running)) && `${project.name} ${project.root}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
    const left = projectTime(a, sort), right = projectTime(b, sort);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    return (left !== null && right !== null ? (sort === "recent" ? right - left : left - right) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

  useEffect(() => {
    // Keep keyboard users oriented when a stopped project's row leaves Running.
    if (app.notice && document.activeElement === document.body) noticeRef.current?.focus();
  }, [app.notice]);

  return (
    <main className="overview-shell">
      <header className="overview-header">
        <a className="overview-brand" href="/" aria-label="Terminal Manager home">Terminal Manager<span className="brand-dot" aria-hidden="true" /></a>
        <div className="overview-title"><h1>Projects</h1><p>{app.loaded ? `${runningServices} running ${runningServices === 1 ? "service" : "services"} across ${runningProjects} ${runningProjects === 1 ? "project" : "projects"}` : "Connecting to Terminal Manager…"}</p></div>
      </header>

      <div className="overview-tools">
        <div className="overview-filters" role="group" aria-label="Filter projects">
          <button type="button" aria-pressed={filter === "running"} onClick={() => setFilter("running")}>Running{app.loaded ? ` (${runningProjects})` : ""}</button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All{app.loaded ? ` (${app.projects.length})` : ""}</button>
        </div>
        <label className="overview-search"><span className="sr-only">Search projects</span><input type="search" placeholder="Find a project…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="overview-sort"><span className="sr-only">Sort projects</span><select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Recently started</option><option value="longest">Longest running</option></select></label>
      </div>

      {app.error && <div className="overview-warning" role="alert"><strong>Cannot refresh Terminal Manager.</strong> {app.error}. {app.lastUpdated ? `Showing state from ${new Date(app.lastUpdated).toLocaleTimeString()}.` : "No runtime state available."} <button type="button" onClick={() => { void app.refresh(); }}>Retry</button></div>}
      {app.metadataError && <p className="overview-warning">Some start times could not be loaded. Runtime state is available.</p>}
      <p ref={noticeRef} className="overview-notice" role="status" tabIndex={-1}>{app.notice}</p>
      {Object.entries(app.actionErrors).map(([key, message]) => <p className="overview-warning" role="alert" key={key}>{message}</p>)}

      {!app.loaded && !app.error ? <p className="overview-empty">Loading projects…</p> : null}
      {app.loaded && !visible.length && <div className="overview-empty">
        <h2>{query.trim() ? "No matching projects" : !app.projects.length ? "No projects yet" : "Nothing running"}</h2>
        <p>{query.trim() ? "Try another project name or path." : !app.projects.length ? "Ask your agent to register a project and configure its services in Terminal Manager." : "Your projects are still here, ready for next time."}</p>
        {!!app.projects.length && filter === "running" && <button className="btn btn-sm btn-outline" onClick={() => setFilter("all")}>Show all projects</button>}
      </div>}

      <div className="overview-projects" aria-label="Projects">
        {visible.map((project) => {
          const recent = projectTime(project, "recent");
          return (
            <section className="overview-project" key={project.id} aria-label={project.name}>
              <div className="overview-project-heading">
                <div><h2><a href={projectHref(project.id)}>{project.name}</a></h2><p className="overview-path" title={project.root}>{project.root}</p></div>
                <p className="overview-recency" title={recent !== null ? new Date(recent).toLocaleString() : undefined}>{recent !== null ? `Last started ${elapsed(recent, now)} ago` : "Start time unknown"}</p>
              </div>
              {project.configError && <p className="overview-warning" role="alert">{project.configError} <a href={projectHref(project.id)}>Project details</a></p>}
              {!project.configError && !project.services.length && <p className="overview-no-services">No services configured. Ask your agent to configure this project.</p>}
              {!project.configError && project.services.map((service) => {
                const key = serviceKey(project.id, service.name);
                const started = startTime(service.startedAt);
                const pending = app.pending[key];
                const status = serviceLifecycleStatus(service);
                return <div className="overview-service" key={service.name} data-service={service.name}>
                  <div className="overview-service-info">
                    <a className="overview-service-name" href={projectHref(project.id, service.name)}>{service.name}</a>
                    <span className="overview-service-status" data-state={status}><span className="status-dot" aria-hidden="true" />{status === "ready" ? "Running" : status === "starting" ? "Starting" : status === "error" ? "Failed" : "Stopped"}</span>
                    {service.running && <span className="overview-duration" title={started !== null ? new Date(started).toLocaleString() : undefined}>{started !== null ? `Running for ${elapsed(started, now)}` : "Start time unknown"}</span>}
                  </div>
                  <div className="overview-service-actions">
                    {service.running && status === "ready" && service.effectiveUrl && <a className="overview-open" href={service.effectiveUrl} target="_blank" rel="noreferrer" aria-label={`Open ${project.name} ${service.name}`}>Open app <span aria-hidden="true">↗</span></a>}
                    <button type="button" className={`btn btn-sm ${service.running ? "btn-outline" : "btn-ghost"}`} aria-label={`${service.running ? "Stop" : "Start"} ${project.name} ${service.name}`} disabled={Boolean(pending) || Boolean(app.error)} onClick={() => { void app.act(service.running ? "stop" : "start", project, service); }}>{pending ? pending.action === "stop" ? "Stopping…" : "Starting…" : service.running ? "Stop" : "Start"}</button>
                  </div>
                </div>;
              })}
            </section>
          );
        })}
      </div>
    </main>
  );
}
