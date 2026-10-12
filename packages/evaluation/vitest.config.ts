import { defineConfig } from "vitest/config";

export default defineConfig({
  // Os testes de integração compartilham o banco _test com os da API: nunca em paralelo entre arquivos.
  test: { fileParallelism: false },
});
