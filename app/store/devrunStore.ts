import { create } from "zustand";
import type { HistoryEntry, ProjectState } from "../types";

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

const initialState = {
  projects: [] as ProjectState[],
  selectedProjectId: null as string | null,
  selectedServiceByProject: {} as Record<string, string>,
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
    set({ selectedProjectId });
  },
  setSelectedServiceByProject: (selectedServiceByProject) => {
    set({ selectedServiceByProject });
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
    set(initialState);
  },
}));
