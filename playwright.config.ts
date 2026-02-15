import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:4421",
    headless: true,
  },
  webServer: {
    command: "npm run build && PORT=4421 node dist/server.js",
    url: "http://localhost:4421/api/state",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
