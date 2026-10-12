-- Camada opcional do modelo no diagnóstico (ADR-008, opção B). Guarda qual modelo e qual versão de prompt rodaram e o
-- desfecho; nunca o texto do resumo (mesma regra do ADR-011).
ALTER TABLE ai_runs
  ADD COLUMN llm_model text,
  ADD COLUMN llm_prompt_version text,
  ADD COLUMN llm_outcome text CHECK (llm_outcome IN ('ok', 'provider_error', 'invalid_output', 'uncited')),
  ADD COLUMN llm_discarded_citations integer NOT NULL DEFAULT 0 CHECK (llm_discarded_citations >= 0),
  ADD CONSTRAINT ai_runs_llm_triple CHECK ((llm_outcome IS NULL) = (llm_model IS NULL) AND (llm_outcome IS NULL) = (llm_prompt_version IS NULL)),
  -- O modo "llm" é a execução em que o resumo foi mostrado, e só ela.
  ADD CONSTRAINT ai_runs_llm_mode CHECK ((mode = 'llm') = (llm_outcome IS NOT DISTINCT FROM 'ok'));
