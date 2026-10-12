import { ApiError } from "./api";

interface Recorded {
  status: number;
  body: unknown;
}

// Respostas gravadas de uma execução local real (apps/e2e/demo/record.spec.ts, ADR-003). O import é sob demanda e só
// existe quando api() entra no modo demo, então o build normal não carrega esses dados.
const recorded = () => import("./demo/recorded.json").then((module) => module.default as Record<string, Recorded>);

export async function demoApi<T>(method: string, path: string): Promise<T> {
  // O "?" vazio que a fila manda (/tickets?) não faz parte da chave.
  const answer = (await recorded())[`${method} ${path.replace(/\?$/, "")}`];
  if (!answer) {
    if (method === "GET") throw new ApiError(404, "Esta resposta não foi gravada na demonstração.");
    throw new ApiError(403, "Demonstração com respostas gravadas: esta ação só funciona na versão local.");
  }
  if (answer.status >= 400) throw new ApiError(answer.status, (answer.body as { detail?: string } | null)?.detail);
  return answer.body as T;
}
