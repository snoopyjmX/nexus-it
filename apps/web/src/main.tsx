import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

// A demonstração é estática: hospedagem sem reescrita de URL só entende rotas por hash.
const Router = import.meta.env.VITE_DEMO === "true" ? HashRouter : BrowserRouter;

createRoot(root).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
