import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { createPool } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { createPasswordHasher } from "../modules/auth/password.js";
import { createUser, UserInputError } from "../modules/auth/users.js";

// Uso: NEXUS_USER_PASSWORD=... pnpm user:create --email a@b.c --name "Ana" --role technician
//  ou: printf '%s' "$SENHA" | pnpm user:create --email a@b.c --name "Ana" --role technician
// A senha nunca vai por argumento: ficaria no histórico do shell e em `ps`.
async function readPassword(): Promise<string | undefined> {
  if (process.env.NEXUS_USER_PASSWORD) return process.env.NEXUS_USER_PASSWORD;
  if (process.stdin.isTTY) return undefined;
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text.split("\n")[0]?.replace(/\r$/, "");
}

const config = loadConfig(process.env);
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);

try {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string" } } });
  const password = await readPassword();
  if (!password) throw new UserInputError("Informe a senha por NEXUS_USER_PASSWORD ou pela entrada padrão.");

  const user = await createUser(pool, createPasswordHasher(), {
    email: values.email ?? "",
    displayName: values.name ?? "",
    role: values.role as "requester" | "technician",
    password,
  });
  logger.info({ id: user.id, role: user.role }, "usuário criado");
} catch (error) {
  if (error instanceof UserInputError) logger.error(error.message);
  else logger.fatal({ err: error }, "criação de usuário falhou");
  process.exitCode = 1;
} finally {
  await pool.end();
}
