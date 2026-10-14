import { expect, test } from "@playwright/test";
import { as } from "../as.js";
import { expectContrast, expectReflow } from "../a11y.js";

// NFR-06 medido nas telas que a demonstração não tem: login e as do solicitante (pilha real).
test("login: contraste AA e reflow em 320 px", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Entrar no NEXUS IT" })).toBeVisible();
  await expectContrast(page, "login");
  await expectReflow(page, "login");
});

test("telas do solicitante: contraste AA e reflow em 320 px", async ({ browser }) => {
  const page = await as(browser, "requester1");
  await page.goto("/chamados");
  await expect(page.getByRole("heading", { name: "Meus chamados" })).toBeVisible();
  await expectContrast(page, "meus chamados");
  await expectReflow(page, "meus chamados");

  await page.goto("/chamados/novo");
  await expect(page.getByRole("heading", { name: "Novo chamado" })).toBeVisible();
  await expectContrast(page, "novo chamado");
  await expectReflow(page, "novo chamado");

  await page.goto("/base");
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  await expectContrast(page, "base (solicitante)");
  await expectReflow(page, "base (solicitante)");
});
