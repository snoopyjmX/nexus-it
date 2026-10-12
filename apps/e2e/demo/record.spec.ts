import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PASSWORD, USERS } from "../env.js";
import { demoQueries } from "./scenario.js";

// Grava as respostas da API que a demonstração estática vai servir (ADR-003). Roda com `pnpm demo:record`, contra a pilha real
// (API, Postgres e Vite) semeada por prepare-demo-db.ts. Só entram GET e o POST do diagnóstico; o resto a demo recusa.
const OUT = new URL("../../web/src/demo/recorded.json", import.meta.url);

test("grava a demonstração", async ({ page }) => {
  test.setTimeout(240_000);
  const recorded: Record<string, { status: number; body: unknown }> = {};
  const pending: Promise<void>[] = [];

  page.on("response", (response) => {
    const url = response.url();
    const at = url.indexOf("/api/v1");
    if (at < 0) return;
    const method = response.request().method();
    // Mesma chave que api() usa em modo demo: o "?" vazio da URL não conta.
    const path = url.slice(at + "/api/v1".length).replace(/\?$/, "");
    if (method !== "GET" && !(method === "POST" && path.endsWith("/diagnosis"))) return;
    pending.push(response.json().then((body: unknown) => void (recorded[`${method} ${path}`] = { status: response.status(), body }), () => undefined));
  });

  const hrefs = (selector: string) => page.locator(selector).evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(USERS.technician);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();

  // Fila e, para cada chamado aberto, o detalhe e o diagnóstico.
  const visit = new Set<string>();
  for (const query of demoQueries()) {
    await page.goto("/chamados");
    await page.getByRole("link", { name: query.texto, exact: true }).click();
    await page.getByRole("button", { name: "Gerar diagnóstico" }).click();
    await expect(page.getByText(/Evidência insuficiente|Evidência não verificada|Acima do limiar/)).toBeVisible({ timeout: 60_000 });
    for (const href of await hrefs('aside a[href^="/base/"], aside a[href^="/chamados/"]')) visit.add(href);
  }

  // Todos os chamados da fila, para que clicar em qualquer um funcione na demonstração.
  await page.goto("/chamados");
  await expect(page.getByRole("heading", { name: "Fila de chamados" })).toBeVisible();
  for (const href of await hrefs('main ul a[href^="/chamados/"]')) visit.add(href);

  // Base: lista com os dois filtros e todos os artigos.
  await page.goto("/base");
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  for (const status of ["draft", "published", ""]) {
    await Promise.all([page.waitForResponse((response) => response.url().includes("/articles?") && (status === "" ? !response.url().includes("status=") : response.url().includes(`status=${status}`))), page.getByLabel("Situação").selectOption(status)]);
  }
  for (const href of await hrefs('main a[href^="/base/"]')) if (href !== "/base/novo") visit.add(href);

  // Buscas: o texto de duas consultas dev.
  for (const query of demoQueries().slice(0, 2)) {
    await page.goto("/base");
    await page.getByLabel("Buscar na base").fill(query.texto);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /resultados? para|Nada encontrado/ })).toBeVisible();
    for (const href of await hrefs('main ul a[href^="/base/"], main ul a[href^="/chamados/"]')) visit.add(href);
  }

  for (const href of visit) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Comentários e eventos são pedidos depois do chamado; sair antes disso perderia a gravação deles.
    await page.waitForLoadState("networkidle");
  }
  await page.goto("/chamados");
  await expect(page.getByRole("heading", { name: "Fila de chamados" })).toBeVisible();

  await page.goto("/laboratorio");
  await expect(page.getByRole("heading", { name: "Laboratório" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Execuções" })).toBeVisible();

  await Promise.all(pending);

  // O token CSRF da gravação não vale em lugar nenhum e não deve parecer um.
  const me = recorded["GET /auth/me"]?.body as { csrfToken?: string } | undefined;
  if (me) me.csrfToken = "demo";
  expect(Object.keys(recorded)).toEqual(expect.arrayContaining(["GET /auth/me", "GET /tickets", "GET /articles?limit=50", "GET /eval/runs", "GET /search/status"]));
  expect(Object.keys(recorded).filter((key) => key.startsWith("POST ") && key.endsWith("/diagnosis"))).toHaveLength(demoQueries().length);

  // Resumo de modelo gravado seria texto público não revisado: a demonstração só leva diagnóstico determinístico.
  for (const [key, answer] of Object.entries(recorded)) {
    if (key.endsWith("/diagnosis")) expect((answer.body as { llm?: string }).llm, key).toBe("off");
  }

  const sorted = Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
});
