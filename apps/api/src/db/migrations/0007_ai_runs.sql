-- Execuções do diagnóstico (FR-09, FR-10, FR-11; ADR-011). Guarda ids e o desfecho; nunca o texto do
-- chamado, das fontes nem dos passos. O feedback do técnico mora na própria linha e não altera artigo nem chamado.
CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets (id),
  user_id uuid NOT NULL REFERENCES users (id),
  mode text NOT NULL CHECK (mode IN ('deterministic', 'llm')),
  search_mode text NOT NULL CHECK (search_mode IN ('vector', 'lexical')),
  degraded boolean NOT NULL,
  retrieved jsonb NOT NULL,
  abstained boolean NOT NULL,
  -- threshold: fontes a partir do limiar. unverified: sem limiar aplicado (FR-10).
  evidence text CHECK (evidence IN ('threshold', 'unverified')),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  feedback_useful boolean,
  feedback_note text CHECK (feedback_note IS NULL OR char_length(feedback_note) BETWEEN 1 AND 1000),
  feedback_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Abstenção não tem evidência; resposta tem.
  CONSTRAINT ai_runs_abstained_evidence CHECK (abstained = (evidence IS NULL)),
  CONSTRAINT ai_runs_feedback_pair CHECK ((feedback_useful IS NULL) = (feedback_at IS NULL)),
  CONSTRAINT ai_runs_note_needs_feedback CHECK (feedback_note IS NULL OR feedback_useful IS NOT NULL)
);

CREATE INDEX ai_runs_ticket_idx ON ai_runs (ticket_id, created_at DESC);
