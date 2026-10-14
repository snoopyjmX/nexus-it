import { expect, test } from "@playwright/test";
import { expectContrast, expectReflow } from "../a11y.js";

// NFR-06 medido, não estimado: contraste e reflow nas telas do técnico, usando a demonstração estática
// (dados gravados, determinísticos, sem banco), que inclui o painel de diagnóstico e o laboratório.
test("telas do técnico: contraste AA e reflow em 320 px", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  await expectContrast(page, "início");
  await expectReflow(page, "início");

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Fila" }).click();
  await expect(page.getByRole("heading", { name: "Fila de chamados" })).toBeVisible();
  await expectContrast(page, "fila");
  await expectReflow(page, "fila");

  await page.getByRole("listitem").filter({ hasText: "Aberto" }).first().getByRole("link").click();
  await page.getByRole("button", { name: "Gerar diagnóstico" }).click();
  await expect(page.getByRole("region", { name: "Fontes" })).toBeVisible();
  await expectContrast(page, "detalhe do chamado com diagnóstico");
  await expectReflow(page, "detalhe do chamado com diagnóstico");

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Base de conhecimento" }).click();
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  await expectContrast(page, "base de conhecimento");
  await expectReflow(page, "base de conhecimento");
  await page.getByRole("listitem").first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Procedimento" })).toBeVisible();
  await expectContrast(page, "artigo");
  await expectReflow(page, "artigo");

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Laboratório" }).click();
  await expect(page.getByRole("table", { name: "Execuções" })).toBeVisible();
  await page.getByText("Consultas uma a uma").click();
  await page.getByText("Resumos gerados, caso a caso").click();
  await expectContrast(page, "laboratório");
  await expectReflow(page, "laboratório");
});
