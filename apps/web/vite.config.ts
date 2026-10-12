import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Em desenvolvimento, /api vai para a API local: mesma origem para o navegador,
// sem CORS aberto (ADR-004). `changeOrigin: false` mantém o Host do navegador: com o padrão do
// Vite o Host vira o da API e a checagem de Origin (T-16) recusa todo POST com 403.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
