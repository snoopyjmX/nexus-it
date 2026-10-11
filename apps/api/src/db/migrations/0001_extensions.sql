-- unaccent: busca full-text em português sem depender de acento (busca lexical, FR-07).
-- A extensão vector só entra se a busca vetorial passar no gate da Semana 0 (FR-08).
CREATE EXTENSION IF NOT EXISTS unaccent;
