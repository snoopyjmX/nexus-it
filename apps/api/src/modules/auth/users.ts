import type pg from "pg";
import { z } from "zod";
import type { PasswordHasher } from "./password.js";

export const ROLES = ["requester", "technician"] as const;
export type Role = (typeof ROLES)[number];

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

// Erro de entrada que o CLI pode mostrar ao operador como está.
export class UserInputError extends Error {}

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(MAX_PASSWORD_LENGTH, `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);

const newUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail inválido.")),
    displayName: z.string().trim().min(1, "Nome obrigatório.").max(100, "Nome longo demais."),
    role: z.enum(ROLES, { error: "Papel inválido: use requester ou technician." }),
    password: passwordSchema,
  })
  .strict();

export type NewUser = z.input<typeof newUserSchema>;

export async function createUser(pool: Pick<pg.Pool, "query">, hasher: PasswordHasher, input: NewUser): Promise<PublicUser> {
  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) throw new UserInputError(parsed.error.issues.map((issue) => issue.message).join(" "));
  const { email, displayName, role, password } = parsed.data;

  const passwordHash = await hasher.hash(password);
  try {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      [email, displayName, passwordHash, role],
    );
    return { id: String(rows[0]?.id), email, displayName, role };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new UserInputError("Usuário já existe com este e-mail.");
    }
    throw error;
  }
}

export interface LoginRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  passwordHash: string;
}

export async function findForLogin(pool: Pick<pg.Pool, "query">, email: string): Promise<LoginRecord | null> {
  const { rows } = await pool.query<{ id: string; email: string; display_name: string; role: Role; active: boolean; password_hash: string }>(
    "SELECT id, email, display_name, role, active, password_hash FROM users WHERE email = $1",
    [email],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role, active: row.active, passwordHash: row.password_hash } : null;
}
