import { defineConfig } from "vitest/config";

export default defineConfig({
  // setupFiles: carrega DATABASE_URL de .env.test como na API (na CI a variável vem do workflow).
  // Os testes de integração compartilham o banco _test com os da API: nunca em paralelo entre arquivos.
  test: { fileParallelism: false, setupFiles: ["../../apps/api/test/setup.ts"] },
});
