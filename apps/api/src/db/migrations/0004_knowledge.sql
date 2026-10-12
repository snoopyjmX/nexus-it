-- Base de conhecimento e busca lexical (FR-06, FR-07, FR-15).
-- O embedding entra com a busca vetorial (Fase 3, ADR-007), não aqui.

-- unaccent é STABLE; este invólucro IMMUTABLE permite usá-lo em coluna gerada e em índice.
CREATE FUNCTION f_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

CREATE TABLE kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  symptom text NOT NULL CHECK (char_length(symptom) BETWEEN 1 AND 5000),
  environment text NOT NULL CHECK (char_length(environment) BETWEEN 1 AND 2000),
  procedure text NOT NULL CHECK (char_length(procedure) BETWEEN 1 AND 10000),
  expected_result text NOT NULL CHECK (char_length(expected_result) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  version integer NOT NULL DEFAULT 1,
  author_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Pesos: título A, sintoma B, ambiente e procedimento C, resultado esperado D.
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', f_unaccent(title)), 'A') ||
    setweight(to_tsvector('portuguese', f_unaccent(symptom)), 'B') ||
    setweight(to_tsvector('portuguese', f_unaccent(environment || ' ' || procedure)), 'C') ||
    setweight(to_tsvector('portuguese', f_unaccent(expected_result)), 'D')
  ) STORED
);

CREATE INDEX kb_articles_search_idx ON kb_articles USING gin (search);
CREATE INDEX kb_articles_list_idx ON kb_articles (created_at DESC, id DESC);

CREATE TABLE kb_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9][a-z0-9._-]{0,29}$')
);

CREATE TABLE kb_article_tags (
  article_id uuid NOT NULL REFERENCES kb_articles (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES kb_tags (id),
  PRIMARY KEY (article_id, tag_id)
);

CREATE INDEX kb_article_tags_tag_idx ON kb_article_tags (tag_id);
