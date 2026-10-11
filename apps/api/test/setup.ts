import { existsSync } from "node:fs";

// Carrega DATABASE_URL de .env.test na raiz, se existir (recurso nativo do Node).
// Na CI a variável vem do workflow.
const envFile = new URL("../../../.env.test", import.meta.url);
if (!process.env.DATABASE_URL && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
