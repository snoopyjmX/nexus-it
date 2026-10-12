-- Busca lexical em chamados (FR-07). Só chamados resolvidos ou fechados entram nos resultados;
-- o filtro de status fica na própria consulta (FR-15), não aqui.
ALTER TABLE tickets ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('portuguese', f_unaccent(title)), 'A') ||
  setweight(to_tsvector('portuguese', f_unaccent(description)), 'B') ||
  setweight(to_tsvector('portuguese', f_unaccent(coalesce(resolution_note, ''))), 'B')
) STORED;

CREATE INDEX tickets_search_idx ON tickets USING gin (search);
