import { defineConfig } from "@playwright/test";

// Use an already-running Devrun. Never boot another manager against shared state.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["workspace.spec.ts", "overview.spec.ts", "terminal-reliability.spec.ts"],
  timeout: 45_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:4317",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});
