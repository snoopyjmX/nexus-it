import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Os testes de integração compartilham um único banco _test.
    fileParallelism: false,
  },
});
