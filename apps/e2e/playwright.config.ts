import "../api/test/setup.js";
import { defineConfig, devices } from "@playwright/test";
import { API_PORT, DEMO_PORT, WEB_PORT } from "./env.js";

// DEMO_RECORD=1 troca o roteiro de teste pelo que grava a demonstração (ADR-003): mesmo servidor, outro banco semeado.
const record = process.env.DEMO_RECORD === "1";

export default defineConfig({
  testDir: record ? "demo" : "tests",
  // Um só banco compartilhado (nexus_test): um teste por vez.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "on-first-retry" },
  projects: record
    ? [{ name: "chromium", testMatch: /record\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }]
    : [
        { name: "setup", testMatch: /auth\.setup\.ts/ },
        { name: "chromium", testIgnore: [/auth\.setup\.ts/, /[\\/]demo(-a11y)?\.spec\.ts$/], use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
        // A demonstração estática não usa API nem login: build de demo servido como arquivos (ADR-003).
        { name: "demo", testMatch: /[\\/]demo(-a11y)?\.spec\.ts$/, use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEMO_PORT}` } },
      ],
  webServer: [
    {
      name: "API",
      command: `pnpm exec tsx ${record ? "prepare-demo-db.ts" : "prepare-db.ts"} && pnpm exec tsx ../api/src/server.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      // No e2e o modelo de linguagem está ligado mas fora do ar (porta fechada): chamados, base e o painel determinístico têm
      // de funcionar assim (T-12, FR-13). A gravação da demo exige o modelo desligado (explícito, para não herdar do shell), para não gravar texto de modelo.
      env: { PORT: String(API_PORT), NODE_ENV: "test", LOG_LEVEL: "warn", ...(record ? { LLM_ENABLED: "false", EMBEDDINGS_ENABLED: "false" } : { LLM_ENABLED: "true", OLLAMA_BASE_URL: "http://127.0.0.1:9" }) },
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
    ...(record
      ? []
      : [
          {
            name: "Demo",
            command: `pnpm --filter @nexus/web build:demo && pnpm --filter @nexus/web exec vite preview --outDir dist-demo --port ${DEMO_PORT} --strictPort`,
            url: `http://localhost:${DEMO_PORT}`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ]),
  ],
});
