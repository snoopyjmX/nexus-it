import { useEffect, useState } from "react";

type Status = "verificando" | "ok" | "indisponível";

// Tela provisória da Fase 1: confirma que web, API e banco conversam.
export function App() {
  const [status, setStatus] = useState<Status>("verificando");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/health/ready", { signal: controller.signal })
      .then((res) => setStatus(res.ok ? "ok" : "indisponível"))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("indisponível");
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>NEXUS IT</h1>
      <p role="status">API e banco: {status}</p>
    </main>
  );
}
