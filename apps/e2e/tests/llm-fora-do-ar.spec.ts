import { expect, test } from "@playwright/test";
import { as } from "../as.js";

// T-12 e FR-13: com o modelo de linguagem ligado mas fora do ar (a API do e2e aponta para uma porta fechada), chamados,
// base e o painel de diagnóstico seguem inteiros: fontes e passos vêm do procedimento, e a tela avisa que o resumo não saiu.
test("diagnóstico com o modelo fora do ar: fontes e passos aparecem e a tela avisa", async ({ browser }) => {
  const stamp = Date.now();
  const articleTitle = `Impressora sem toner ${stamp}`;
  const ticketTitle = `Impressora não imprime ${stamp}`;

  const technician = await as(browser, "technician");
  await technician.goto("/base/novo");
  await technician.getByLabel("Título").fill(articleTitle);
  await technician.getByLabel("Sintoma").fill("A impressora do andar não imprime e mostra aviso de toner baixo.");
  await technician.getByLabel("Ambiente").fill("Impressora de rede do setor administrativo.");
  await technician.getByLabel("Procedimento").fill("1. Troque o cartucho de toner.\n2. Imprima uma página de teste.");
  await technician.getByLabel("Resultado esperado").fill("A impressora volta a imprimir.");
  await technician.getByLabel("Tags (separadas por vírgula)").fill("impressora, toner");
  await technician.getByRole("button", { name: "Salvar" }).click();
  await technician.getByRole("button", { name: "Publicar" }).click();
  await expect(technician.getByRole("button", { name: "Despublicar" })).toBeVisible();

  const requester = await as(browser, "requester1");
  await requester.goto("/chamados/novo");
  await requester.getByLabel("Título").fill(ticketTitle);
  await requester.getByLabel("Descrição").fill("A impressora não imprime e mostra toner baixo.");
  await requester.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(requester.getByRole("heading", { level: 1, name: ticketTitle })).toBeVisible();

  await technician.goto("/chamados");
  await technician.getByRole("link", { name: ticketTitle }).click();
  await technician.getByRole("button", { name: "Gerar diagnóstico" }).click();

  const sources = technician.getByRole("region", { name: "Fontes" });
  await expect(sources.getByRole("link", { name: articleTitle })).toBeVisible();
  await expect(technician.getByRole("heading", { name: "Próximos testes" })).toBeVisible();
  await expect(technician.getByRole("list", { name: `Passos de ${articleTitle}` }).getByText("Troque o cartucho de toner.")).toBeVisible();
  await expect(technician.getByRole("note").filter({ hasText: "O resumo por modelo não está disponível agora" })).toBeVisible();
  await expect(technician.getByText("Resumo gerado por IA")).toHaveCount(0);
});
