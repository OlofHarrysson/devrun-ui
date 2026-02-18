import { create } from "zustand";
import type { HistoryEntry, ProjectState } from "../types/ui";

export interface DevrunStoreState {
  projects: ProjectState[];
  selectedProjectId: string | null;
  selectedServiceByProject: Record<string, string>;
  historyByService: Record<string, HistoryEntry | undefined>;
  activeTerminalKey: string | null;
  terminalKeys: string[];
  terminalVersion: number;
  setProjects: (projects: ProjectState[]) => void;
  setSelectedProjectId: (selectedProjectId: string | null) => void;
  setSelectedServiceByProject: (selectedServiceByProject: Record<string, string>) => void;
  setHistoryByService: (
    updater: (
      previous: Record<string, HistoryEntry | undefined>,
    ) => Record<string, HistoryEntry | undefined>,
  ) => void;
  setActiveTerminalKey: (activeTerminalKey: string | null) => void;
  addTerminalKey: (key: string) => void;
  bumpTerminalVersion: () => void;
  resetState: () => void;
}

type PersistedSelection = {
  selectedProjectId: string | null;
  selectedServiceByProject: Record<string, string>;
};

const SELECTION_STORAGE_KEY = "devrun-ui.selection.v1";

function readPersistedSelection(): PersistedSelection {
  if (typeof window === "undefined") {
    return {
      selectedProjectId: null,
      selectedServiceByProject: {},
    };
  }

  try {
    const raw = window.localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) {
      return {
        selectedProjectId: null,
        selectedServiceByProject: {},
      };
    }

    const parsed = JSON.parse(raw) as {
      selectedProjectId?: unknown;
      selectedServiceByProject?: unknown;
    };

    const selectedProjectId =
      typeof parsed.selectedProjectId === "string" ? parsed.selectedProjectId : null;
    const selectedServiceByProject: Record<string, string> = {};

    if (
      parsed.selectedServiceByProject &&
      typeof parsed.selectedServiceByProject === "object"
    ) {
      for (const [projectId, serviceName] of Object.entries(
        parsed.selectedServiceByProject as Record<string, unknown>,
      )) {
        if (typeof serviceName === "string") {
          selectedServiceByProject[projectId] = serviceName;
        }
      }
    }

    return {
      selectedProjectId,
      selectedServiceByProject,
    };
  } catch {
    return {
      selectedProjectId: null,
      selectedServiceByProject: {},
    };
  }
}

function writePersistedSelection(selection: PersistedSelection) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Ignore storage failures (private mode/quota/etc).
  }
}

const persistedSelection = readPersistedSelection();

const initialState = {
  projects: [] as ProjectState[],
  selectedProjectId: persistedSelection.selectedProjectId as string | null,
  selectedServiceByProject:
    persistedSelection.selectedServiceByProject as Record<string, string>,
  historyByService: {} as Record<string, HistoryEntry | undefined>,
  activeTerminalKey: null as string | null,
  terminalKeys: [] as string[],
  terminalVersion: 0,
};

export const useDevrunStore = create<DevrunStoreState>((set) => ({
  ...initialState,
  setProjects: (projects) => {
    set({ projects });
  },
  setSelectedProjectId: (selectedProjectId) => {
    set((state) => {
      writePersistedSelection({
        selectedProjectId,
        selectedServiceByProject: state.selectedServiceByProject,
      });
      return { selectedProjectId };
    });
  },
  setSelectedServiceByProject: (selectedServiceByProject) => {
    set((state) => {
      writePersistedSelection({
        selectedProjectId: state.selectedProjectId,
        selectedServiceByProject,
      });
      return { selectedServiceByProject };
    });
  },
  setHistoryByService: (updater) => {
    set((state) => ({
      historyByService: updater(state.historyByService),
    }));
  },
  setActiveTerminalKey: (activeTerminalKey) => {
    set({ activeTerminalKey });
  },
  addTerminalKey: (key) => {
    set((state) => ({
      terminalKeys: state.terminalKeys.includes(key)
        ? state.terminalKeys
        : [...state.terminalKeys, key],
    }));
  },
  bumpTerminalVersion: () => {
    set((state) => ({
      terminalVersion: state.terminalVersion + 1,
    }));
  },
  resetState: () => {
    const persisted = readPersistedSelection();
    set({
      ...initialState,
      selectedProjectId: persisted.selectedProjectId,
      selectedServiceByProject: persisted.selectedServiceByProject,
    });
  },
}));
