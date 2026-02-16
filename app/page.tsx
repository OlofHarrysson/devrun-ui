"use client";

import { CommandBar } from "./components/CommandBar";
import { ProjectHeader } from "./components/ProjectHeader";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { useDevrunApp } from "./hooks/useDevrunApp";

export default function HomePage() {
  const app = useDevrunApp();

  return (
    <div className="layout">
      <Sidebar
        projects={app.projects}
        selectedProjectId={app.selectedProjectId}
        onAddProject={app.addProject}
        onSelectProject={app.selectProject}
      />

      <main className="main">
        <section className="workspace-top">
          <ProjectHeader
            selectedProject={app.selectedProject}
            onConfigureProject={app.configureProject}
            onRemoveProject={app.removeProject}
          />
          <CommandBar
            selectedProject={app.selectedProject}
            selectedService={app.selectedService}
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
