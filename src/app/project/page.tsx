"use client";

import { CommandBar } from "../../components/CommandBar";
import { ProjectHeader } from "../../components/ProjectHeader";
import { Sidebar } from "../../components/Sidebar";
import { TerminalPanel } from "../../components/TerminalPanel";
import { useDevrunApp } from "../../hooks/useDevrunApp";

export default function ProjectPage() {
  const app = useDevrunApp();

  return (
    <div className="workspace-shell">
      <Sidebar
        projects={app.projects}
        selectedProjectId={app.selectedProjectId}
        onSelectProject={app.selectProject}
      />

      <main className="workspace-main">
        <section className="workspace-heading">
          <a className="back-to-projects" href="/">← All projects</a>
          <ProjectHeader
            selectedProject={app.selectedProject}
            onRemoveProject={app.removeProject}
          />
          <CommandBar
            selectedProject={app.selectedProject}
            selectedService={app.selectedService}
            onOpenLog={app.openServiceLog}
            onAction={app.onAction}
          />
        </section>

        <TerminalPanel
          selectedProject={app.selectedProject}
          selectedService={app.selectedService}
          terminalKeys={app.terminalKeys}
          activeTerminalKey={app.activeTerminalKey}
          terminalEmptyMessage={app.terminalEmptyMessage}
          selectedHistoryEntry={app.selectedHistoryEntry}
          historyEvents={app.historyEvents}
          historyItems={app.historyItems}
          getServiceConnectionState={app.getServiceConnectionState}
          onSelectService={async (serviceName) => {
            if (!app.selectedProject) {
              return;
            }
            await app.selectProject(app.selectedProject, serviceName);
          }}
          attachTerminalContainer={app.attachTerminalContainer}
        />
      </main>
    </div>
  );
}
