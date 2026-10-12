import { expect, test } from "@playwright/test";

// ADR-003: a demonstração estática é o build com respostas gravadas, servido como arquivos, sem API e sem login.
test("a demonstração estática navega com as respostas gravadas e recusa escrever", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1")) apiCalls.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("note")).toContainText("gravadas");
  await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Fila" }).click();
  await expect(page).toHaveURL(/#\/chamados$/);
  await expect(page.getByRole("heading", { name: "Fila de chamados" })).toBeVisible();

  // Um chamado aberto: o diagnóstico gravado aparece, com as fontes.
  const open = page.getByRole("listitem").filter({ hasText: "Aberto" }).first();
  await open.getByRole("link").click();
  await page.getByRole("button", { name: "Gerar diagnóstico" }).click();
  await expect(page.getByRole("region", { name: "Fontes" }).getByRole("link").first()).toBeVisible();

  // Escrever não funciona, e a tela diz por quê.
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByRole("alert")).toContainText("só funciona na versão local");

  // Recarregar numa rota interna continua funcionando (hospedagem estática, sem reescrita de URL).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(apiCalls).toEqual([]);
});
