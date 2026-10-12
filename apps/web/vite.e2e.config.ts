import { mergeConfig } from "vite";
import base from "./vite.config.js";

// Só para o e2e (ADR-013): o proxy aponta para a API que o Playwright sobe, qualquer que seja a porta
// do proxy de desenvolvimento em vite.config.ts.
export default mergeConfig(base, {
  server: { proxy: { "/api": { target: `http://127.0.0.1:${process.env.E2E_API_PORT}`, changeOrigin: false } } },
});
