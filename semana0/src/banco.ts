import pg from "pg";
import type { Documento } from "./dados.js";
import type { Resultado } from "./metricas.js";

// O experimento apaga e recria o schema: só roda num banco dedicado.
export function conferirUrl(url: string | undefined): string {
  if (!url) throw new Error("Defina DATABASE_URL apontando para o banco nexus_semana0 (ou *_test).");
  const nome = new URL(url).pathname.slice(1);
  if (!/(_semana0|_test)$/.test(nome)) throw new Error(`Banco "${nome}" recusado: use um banco terminado em _semana0 ou _test.`);
  return url;
}

export function textoCompleto(d: Documento): string {
  return [d.titulo, d.sintoma, d.ambiente, d.procedimento, d.resultado].filter(Boolean).join("\n");
}

export async function indexar(pool: pg.Pool, documentos: Documento[], vetores: number[][]): Promise<void> {
  const dim = vetores[0]?.length;
  if (!dim || vetores.some((v) => v.length !== dim)) throw new Error("Vetores vazios ou de dimensões diferentes");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS unaccent");
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("DROP TABLE IF EXISTS semana0_documento");
    // dim vem do próprio modelo (número), não de entrada do usuário.
    await client.query(`CREATE TABLE semana0_documento (
      id text PRIMARY KEY,
      categoria text NOT NULL,
      busca tsvector NOT NULL,
      embedding vector(${dim}) NOT NULL
    )`);
    for (const [i, d] of documentos.entries()) {
      // Pesos do protocolo: título+sintoma A, procedimento B. Ambiente e resultado entram
      // como C para o lexical ver o mesmo texto que o vetor.
      await client.query(
        `INSERT INTO semana0_documento (id, categoria, busca, embedding) VALUES ($1, $2,
          setweight(to_tsvector('portuguese', unaccent($3)), 'A') ||
          setweight(to_tsvector('portuguese', unaccent($4)), 'B') ||
          setweight(to_tsvector('portuguese', unaccent($5)), 'C'),
          $6::vector)`,
        [d.id, d.categoria, `${d.titulo} ${d.sintoma}`, d.procedimento, `${d.ambiente} ${d.resultado}`, JSON.stringify(vetores[i])],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function buscarLexical(pool: pg.Pool, texto: string, limite = 20): Promise<Resultado[]> {
  const r = await pool.query<{ id: string; score: number }>(
    `SELECT id, ts_rank_cd(busca, q)::float8 AS score
       FROM semana0_documento, websearch_to_tsquery('portuguese', unaccent($1)) q
      WHERE busca @@ q
      ORDER BY score DESC, id
      LIMIT $2`,
    [texto, limite],
  );
  return r.rows;
}

// Sem índice ANN: varredura sequencial = busca exata. Score = similaridade de cosseno.
export async function buscarVetorial(pool: pg.Pool, vetor: number[], limite = 20): Promise<Resultado[]> {
  const r = await pool.query<{ id: string; score: number }>(
    `SELECT id, (1 - (embedding <=> $1::vector))::float8 AS score
       FROM semana0_documento
      ORDER BY embedding <=> $1::vector, id
      LIMIT $2`,
    [JSON.stringify(vetor), limite],
  );
  return r.rows;
}
