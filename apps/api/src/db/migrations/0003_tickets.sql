-- Chamados, conversa e histórico (FR-03, FR-04, FR-05, ADR-001).
-- O embedding do chamado resolvido entra com a busca vetorial (Fase 3), não aqui.
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
  category text NOT NULL CHECK (category IN ('hardware', 'software', 'network', 'access', 'other')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_requester', 'resolved', 'closed', 'cancelled')),
  requester_id uuid NOT NULL REFERENCES users (id),
  assignee_id uuid REFERENCES users (id),
  resolution_note text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX tickets_requester_idx ON tickets (requester_id, created_at DESC, id DESC);
CREATE INDEX tickets_queue_idx ON tickets (created_at DESC, id DESC);

CREATE TABLE ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ticket_comments_ticket_idx ON ticket_comments (ticket_id, created_at, id);

-- Histórico append-only: o payload guarda só origem e destino, nunca texto livre.
CREATE TABLE ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets (id),
  actor_id uuid NOT NULL REFERENCES users (id),
  event_type text NOT NULL CHECK (event_type IN ('created', 'transitioned', 'assignee_changed', 'priority_changed', 'category_changed', 'edited')),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, created_at, id);

CREATE FUNCTION ticket_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events é append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_events_no_change
  BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION ticket_events_append_only();
