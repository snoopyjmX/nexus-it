-- Execuções da suíte de avaliação (FR-12, docs/AI_EVALUATION.md). Cada linha amarra o resultado à versão do
-- conjunto de dados, ao modelo, ao prompt e ao ambiente. Só o runner CLI grava; a API só lê (GET /eval/runs).
CREATE TABLE eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  dataset_set text NOT NULL CHECK (dataset_set IN ('dev', 'test')),
  -- Hash dos arquivos do conjunto (12 hexadecimais), o mesmo que a Semana 0 registrou como versaoDados.
  dataset_version text NOT NULL CHECK (dataset_version ~ '^[0-9a-f]{12}$'),
  search_mode text NOT NULL CHECK (search_mode IN ('lexical', 'vector')),
  embedding_model text,
  -- Preenchidos só quando a execução avalia a geração (resumo do modelo).
  llm_model text,
  prompt_version text,
  environment jsonb NOT NULL,
  result jsonb NOT NULL,
  CONSTRAINT eval_runs_vector_model CHECK ((search_mode = 'vector') = (embedding_model IS NOT NULL)),
  CONSTRAINT eval_runs_llm_pair CHECK ((llm_model IS NULL) = (prompt_version IS NULL))
);

CREATE INDEX eval_runs_created_idx ON eval_runs (created_at DESC, id DESC);
