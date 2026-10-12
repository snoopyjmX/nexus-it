-- A ordem do histórico e da conversa é a da gravação, não a do relógio. O clock_timestamp() pode empatar ou recuar
-- (medido num Postgres em Docker: 14 recuos de até 1,5 ms e 24 mil empates em 30 mil INSERTs seguidos) e o desempate
-- por uuid aleatório embaralhava eventos gravados na mesma operação (FR-05).
-- Linhas que já existem recebem a numeração na ordem física da tabela, que na prática é a da gravação.
-- O seq reflete a ordem do INSERT, não a do commit; dentro de uma mesma operação (uma transação) a ordem é preservada.
ALTER TABLE ticket_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE ticket_comments ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

DROP INDEX ticket_events_ticket_idx;
DROP INDEX ticket_comments_ticket_idx;
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, seq);
CREATE INDEX ticket_comments_ticket_idx ON ticket_comments (ticket_id, seq);
