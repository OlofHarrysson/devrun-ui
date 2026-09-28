"use client";

import { useEffect, useState } from "react";
import { CommandBar } from "../CommandBar";
import { HistoryPanel } from "../HistoryPanel";
import type { ProjectServiceState, ProjectState } from "../../types/ui";

const baseService: ProjectServiceState = {
  name: "web", cmd: "npm run dev", port: 3000, running: false,
  status: "stopped", ready: false,
};
const project: ProjectState = {
  id: "design-demo", name: "Made by Olof", root: "/projects/madebyolof",
  defaultService: "web", services: [baseService],
};
const palette = [
  ["canvas", "Canvas"], ["surface", "Surface"], ["rule", "Divider"],
  ["ink", "Heading"], ["copy", "Body"], ["muted", "Secondary"],
  ["action", "Action / focus"], ["status-success", "Ready"],
  ["status-warning", "Starting"], ["status-error", "Error"],
];

export function DesignReference() {
  const [service, setService] = useState(baseService);
  const [message, setMessage] = useState("Demo controls only. No processes or API calls.");
  const [theme, setTheme] = useState("olof");
  const status = service.status || "stopped";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="design-reference" data-theme="olof">
      <header className="reference-header">
        <a href="/" className="reference-brand">Devrun</a>
        <nav aria-label="Design reference">
          <a href="#foundations">Theme</a><a href="#components">Components</a><a href="#direction">Direction</a>
        </nav>
      </header>
      <div className="reference-content">
        <section className="reference-intro">
          <h1>A quieter place<br />to keep things running.</h1>
          <p>The Made by Olof theme, adapted for a daily development tool. Charcoal surfaces, clear type, and warm orange where an action matters.</p>
          <a href="/" className="btn btn-primary">Open workspace</a>
          <span className="reference-note">Design study · main workspace unchanged</span>
        </section>

        <section id="foundations" aria-labelledby="theme-heading">
          <h2 id="theme-heading">The theme</h2>
          <p>Exact palette and DM Sans from Made by Olof. Compact controls and monospace output belong to Devrun.</p>
          <div className="palette">
            {palette.map(([token, label]) => (
              <div key={token}><span className="swatch" style={{ background: `var(--color-${token})` }} /><strong>{label}</strong><code>--color-{token}</code></div>
            ))}
          </div>
          <div className="type-samples">
            <div><h3>Made for the work.</h3><p>DM Sans for navigation, controls, and readable status.</p></div>
            <div><code>npm run dev<br /><span>Ready on localhost:3000</span></code><p>System monospace for commands and logs.</p></div>
          </div>
        </section>

        <section id="components" aria-labelledby="components-heading">
          <div className="section-heading"><h2 id="components-heading">Real controls, safe to try</h2>
            <label>Component theme <select aria-label="Component theme" className="select select-sm" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="olof">Made by Olof</option><option value="corporate">Current</option></select></label>
          </div>
          <p>These are the workspace’s CommandBar and HistoryPanel. Start, stop, and restart change only this local sample. Their current layout is preserved to expose what still needs redesigning.</p>
          <div id="component-demo" data-theme={theme}>
            <CommandBar selectedProject={project} selectedService={service}
              {...{ onOpenLog: async () => { setMessage("Demo: no log file is opened."); } }}
              onAction={async (action) => {
                const running = action !== "stop";
                setService({ ...baseService, running, ready: running, status: running ? "ready" : "stopped" });
                setMessage(`Demo: web ${running ? "ready" : "stopped"}. No real process was changed.`);
              }} />
            <HistoryPanel selectedProject={project} selectedService={service} selectedHistoryEntry={null}
              historyEvents={[{ seq: 1, type: status === "ready" ? "start" : "exit" }]}
              historyItems={mounted ? [{ seq: 1, type: status === "ready" ? "start" : "exit", ts: "2026-09-28T09:30:00Z", data: status === "ready" ? { cmd: "npm run dev" } : { exitCode: 0 } }] : []} />
          </div>
          <div className="demo-feedback" role="status">{message}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setService(baseService); setTheme("olof"); setMessage("Demo reset. No processes or API calls."); }}>Reset demo</button>
        </section>

        <section id="direction" aria-labelledby="direction-heading">
          <h2 id="direction-heading">The next workspace</h2>
          <p>Keep project → service → output as the core flow. Make the terminal the visual center and reveal deeper detail when it is useful.</p>
          <ol className="direction-list">
            <li><strong>Find the project. See what needs attention.</strong><span>Quiet project rows, clear selection, search for larger lists, and status that separates ready from starting or failed.</span></li>
            <li><strong>One service, one clear next action.</strong><span>Start when stopped. Open app and restart when running. Keep remove and configuration in a project menu.</span></li>
            <li><strong>Give the output room.</strong><span>One coherent workspace with optional history. On small screens, choose the project before opening its service view.</span></li>
          </ol>
          <p className="reference-note">Directional reference: <a href="https://www.madebyolof.com" target="_blank" rel="noreferrer">Made by Olof</a>. Borrow color, type, and restraint. The portrait, wordmark, hero animation, and editorial scale remain specific to that site.</p>
        </section>
      </div>
    </main>
  );
}
