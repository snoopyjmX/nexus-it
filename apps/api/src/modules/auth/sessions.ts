import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { PublicUser, Role } from "./users.js";

export const COOKIE_NAME = "nexus_sid";
export const IDLE_SECONDS = 30 * 60;
export const ABSOLUTE_SECONDS = 12 * 60 * 60;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const hashToken = (token: string) => sha256(token);
// ADR-009: o CSRF sai do token da sessão por um hash de mão única. Quem lê o token
// CSRF não consegue chegar ao token da sessão, e o banco não guarda nada extra.
export const csrfTokenFor = (token: string) => sha256(`csrf:${token}`);

export interface ResolvedSession {
  user: PublicUser;
  csrfToken: string;
}

export function createSessionStore(pool: Pick<pg.Pool, "query">) {
  return {
    async create(userId: string): Promise<string> {
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        `INSERT INTO sessions (id_hash, user_id, expires_at, idle_expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3), now() + make_interval(secs => $4))`,
        [hashToken(token), userId, ABSOLUTE_SECONDS, IDLE_SECONDS],
      );
      return token;
    },

    // Valida e, na mesma instrução, renova a inatividade (sem passar do limite absoluto).
    // Usuário desativado deixa de valer na hora.
    async resolve(token: string): Promise<ResolvedSession | null> {
      const idHash = hashToken(token);
      const { rows } = await pool.query<{ id: string; email: string; display_name: string; role: Role }>(
        `UPDATE sessions s
            SET idle_expires_at = LEAST(now() + make_interval(secs => $2), s.expires_at)
           FROM users u
          WHERE s.id_hash = $1 AND u.id = s.user_id AND u.active
            AND s.expires_at > now() AND s.idle_expires_at > now()
      RETURNING u.id, u.email, u.display_name, u.role`,
        [idHash, IDLE_SECONDS],
      );
      const row = rows[0];
      if (!row) {
        await pool.query("DELETE FROM sessions WHERE id_hash = $1 AND (expires_at <= now() OR idle_expires_at <= now())", [idHash]);
        return null;
      }
      return {
        user: { id: row.id, email: row.email, displayName: row.display_name, role: row.role },
        csrfToken: csrfTokenFor(token),
      };
    },

    async revoke(token: string): Promise<void> {
      await pool.query("DELETE FROM sessions WHERE id_hash = $1", [hashToken(token)]);
    },

    async purgeExpired(): Promise<void> {
      await pool.query("DELETE FROM sessions WHERE expires_at <= now() OR idle_expires_at <= now()");
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
