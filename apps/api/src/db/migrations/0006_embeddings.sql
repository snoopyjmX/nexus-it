-- Vetores para a busca vetorial (ADR-007, ADR-001): um documento, um vetor, na própria linha,
-- busca exata por cosseno, sem índice ANN. Dimensão fixa de bge-m3.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE kb_articles
  ADD COLUMN embedding vector(1024),
  ADD COLUMN embedding_model text,
  ADD CONSTRAINT kb_articles_embedding_pair CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
  -- FR-15 por construção: despublicar tem de limpar o vetor no mesmo UPDATE, senão o banco recusa.
  ADD CONSTRAINT kb_articles_embedding_only_published CHECK (embedding IS NULL OR status = 'published');

ALTER TABLE tickets
  ADD COLUMN embedding vector(1024),
  ADD COLUMN embedding_model text,
  ADD CONSTRAINT tickets_embedding_pair CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
  -- Só chamado resolvido ou fechado tem vetor; reabrir limpa.
  ADD CONSTRAINT tickets_embedding_only_solved CHECK (embedding IS NULL OR status IN ('resolved', 'closed'));
