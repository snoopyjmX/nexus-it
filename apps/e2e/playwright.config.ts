import "../api/test/setup.js";
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, WEB_PORT } from "./env.js";

export default defineConfig({
  testDir: "tests",
  // Um só banco compartilhado (nexus_test): um teste por vez.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", testIgnore: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: [
    {
      name: "API",
      command: "pnpm exec tsx prepare-db.ts && pnpm exec tsx ../api/src/server.ts",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      env: { PORT: String(API_PORT), NODE_ENV: "test", LOG_LEVEL: "warn" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: "Web",
      command: `pnpm exec vite --config vite.e2e.config.ts --port ${WEB_PORT} --strictPort`,
      cwd: "../web",
      env: { E2E_API_PORT: String(API_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
