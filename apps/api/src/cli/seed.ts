import type pg from "pg";
import type { PasswordHasher } from "../modules/auth/password.js";
import { createUser, passwordSchema, UserInputError, type NewUser } from "../modules/auth/users.js";

// Cenário fictício e previsível (FR-16): 1 técnico e 2 solicitantes.
const SCENARIO: Omit<NewUser, "password">[] = [
  { email: "tecnico@exemplo.local", displayName: "Técnico Demo", role: "technician" },
  { email: "solicitante1@exemplo.local", displayName: "Solicitante Um", role: "requester" },
  { email: "solicitante2@exemplo.local", displayName: "Solicitante Dois", role: "requester" },
];

interface SeedOptions {
  password: string | undefined;
  nodeEnv: string;
}

// A senha vem de fora (SEED_PASSWORD) e não tem valor padrão: um segredo conhecido
// no repositório seria uma credencial pública. Também não roda em produção.
export async function seed(pool: pg.Pool, hasher: PasswordHasher, { password, nodeEnv }: SeedOptions) {
  if (nodeEnv === "production") throw new UserInputError("O seed não roda em produção.");
  if (password === undefined) throw new UserInputError("Defina SEED_PASSWORD (mínimo de 12 caracteres) para criar os usuários.");
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) throw new UserInputError(checked.error.issues.map((issue) => issue.message).join(" "));

  const created: string[] = [];
  const skipped: string[] = [];
  for (const user of SCENARIO) {
    const { rows } = await pool.query("SELECT 1 FROM users WHERE email = $1", [user.email]);
    if (rows.length > 0) {
      skipped.push(user.email);
      continue;
    }
    await createUser(pool, hasher, { ...user, password });
    created.push(user.email);
  }
  return { created, skipped };
}
