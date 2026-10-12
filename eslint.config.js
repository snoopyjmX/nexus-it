import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/**", "**/dist-demo/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      "no-console": "error",
      // `_` marca parâmetro obrigatório pela assinatura (ex.: o 4º argumento
      // de um error handler do Express). Rest siblings servem para omitir campos.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
);
