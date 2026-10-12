import { readFileSync } from "node:fs";

// Os chamados da demonstração usam o texto de consultas que já existem no conjunto dev (nada é escrito aqui):
// a primeira de cada tipo. Cobre uma pergunta direta, uma paráfrase, uma sem resposta na base e uma ambígua.
export const DEMO_TYPES = ["direta", "parafrase", "sem_resposta", "ambigua"] as const;

interface DevQuery {
  tipo: string;
  texto: string;
  categoria: string;
}

const queries = JSON.parse(readFileSync(new URL("../../../packages/evaluation/dataset/dev/consultas.json", import.meta.url), "utf8")) as DevQuery[];

export function demoQueries(): DevQuery[] {
  return DEMO_TYPES.map((tipo) => {
    const query = queries.find((candidate) => candidate.tipo === tipo);
    if (!query) throw new Error(`O conjunto dev não tem consulta do tipo ${tipo}`);
    return query;
  });
}
