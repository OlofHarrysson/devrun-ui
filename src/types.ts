export type RegistryEntry = {
  id: string;
  name: string;
  root: string;
  createdAt: string;
};

export type ProjectService = {
  name: string;
  cmd: string;
  cwd?: string;
};

export type ProjectConfig = {
  name?: string;
  services: ProjectService[];
};

export type ProjectState = {
  id: string;
  name: string;
  root: string;
  configPath: string;
  services: Array<{
    name: string;
    cmd: string;
    cwd?: string;
    running: boolean;
  }>;
  configError?: string;
};
