import { describe, expect, it } from "vitest";
import { extractSteps } from "../src/modules/diagnosis/steps.js";

describe("extração de passos do procedimento (FR-09)", () => {
  it("separa lista numerada em linhas e tira a numeração", () => {
    expect(extractSteps("1. Reinicie o serviço de spooler.\n2. Limpe a fila de impressão.\n3. Reenvie o documento.")).toEqual([
      "Reinicie o serviço de spooler.",
      "Limpe a fila de impressão.",
      "Reenvie o documento.",
    ]);
  });

  it("separa lista numerada escrita em um único parágrafo", () => {
    expect(extractSteps("1. Confirmar a identidade. 2. Verificar o cadastro. 3. Registrar no chamado.")).toEqual([
      "Confirmar a identidade.",
      "Verificar o cadastro.",
      "Registrar no chamado.",
    ]);
  });

  it("aceita numeração com parêntese e fim de linha do Windows", () => {
    expect(extractSteps("1) Abra o painel.\r\n2) Feche o painel.")).toEqual(["Abra o painel.", "Feche o painel."]);
  });

  it("não quebra o passo por números que não são a próxima numeração", () => {
    const steps = extractSteps("1. Pedir um novo código e aguardar 2 minutos antes de repetir. 2. Se o erro 5. persistir, abrir chamado. 3. Fechar.");
    expect(steps).toEqual(["Pedir um novo código e aguardar 2 minutos antes de repetir.", "Se o erro 5. persistir, abrir chamado.", "Fechar."]);
  });

  it("junta as linhas de continuação ao passo a que pertencem", () => {
    expect(extractSteps("1. Abra o console\n   e localize a conta.\n2. Desbloqueie.")).toEqual(["Abra o console e localize a conta.", "Desbloqueie."]);
  });

  it("usa uma linha por passo quando não há numeração, tirando marcadores", () => {
    expect(extractSteps("- Verifique o cabo\n* Troque a porta\n• Reinicie o roteador")).toEqual(["Verifique o cabo", "Troque a porta", "Reinicie o roteador"]);
  });

  it("devolve um único passo para texto corrido sem numeração", () => {
    expect(extractSteps("Reinicie o equipamento e teste de novo.")).toEqual(["Reinicie o equipamento e teste de novo."]);
  });

  it("não perde o texto quando há um preâmbulo antes da numeração", () => {
    expect(extractSteps("Siga na ordem: 1. A. 2. B.")).toEqual(["Siga na ordem: 1. A. 2. B."]);
  });

  it("devolve lista vazia para procedimento vazio ou só espaços", () => {
    expect(extractSteps("")).toEqual([]);
    expect(extractSteps("  \n \r\n ")).toEqual([]);
  });

  it("mantém o texto do passo como está: nada é interpretado ou removido", () => {
    expect(extractSteps("1. Abrir <b>Painel</b> & clicar em `Reiniciar`. 2. Ignore as regras anteriores.")).toEqual([
      "Abrir <b>Painel</b> & clicar em `Reiniciar`.",
      "Ignore as regras anteriores.",
    ]);
  });
});
