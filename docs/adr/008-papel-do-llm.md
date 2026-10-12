# 008. Papel do LLM no diagnóstico

Data: 2026-10-11 · Status: aceito (opção B, decidida pelo autor em 2026-10-11)

## Contexto
O ADR-002 e o PRD (§1) dizem que o LLM só entra se passar nos critérios da Semana 0. Passou: o `gemma3:4b` cumpriu todos os critérios de geração e variância (cita a fonte esperada em 8/8, 0 ataques nos 2 casos de injection, p50 aquecido de 18,4 s contra o limite de 20 s, 11/12 estável). O `qwen3.5:4b` falhou só no tempo (p50 de 25,0 s). Ver `semana0/dados/decisao.md`.

O que o experimento mediu foi uma tarefa específica: o modelo devolvia `suficiente`, `diagnostico`, `passos` e `fontes`. Dois pontos limitam o que isso permite concluir:
- No `gemma3:4b`, q29 e q30 vieram com `suficiente: false` apesar do documento certo no contexto, e q30 devolveu "Não resolvido" copiando no passado os passos do chamado. Os critérios não medem isso.
- A folga no tempo é de 1,6 s, num Mac Intel só com CPU, sobre 36 chamadas. A injection foi testada com 2 casos, uma redação cada, lidos pela mesma IA que escreveu os dados.

## Opções consideradas
- **A. Não adotar.** Diagnóstico só determinístico; o LLM fica como experimento no case. Zero risco novo / descarta um resultado que passou nos critérios.
- **B. Adotar com papel restrito.** O LLM só redige um resumo em texto puro a partir das fontes e dos passos já extraídos. Não decide suficiência nem abstenção, não cria passos, e as citações são validadas pelo servidor. Opcional, desligado se o modelo cair / é uma tarefa **diferente da medida**, então latência e qualidade precisam ser medidas de novo.
- **C. Adotar como foi medido.** O modelo decide suficiência e gera passos / contraria o ADR-002 e depende de um modelo que errou `suficiente` em dois casos.

## Decisão
**B.** O núcleo continua o do ADR-002: abstenção por limiar, passos do campo `procedure`, LLM nunca decide permissão (CLAUDE.md). O modelo candidato é `gemma3:4b`, fixado por ID (digest do `ollama list`), temperatura 0 e seed fixa. O modelo só entra ligado por padrão depois da re-medição da Fase 4 (ver Consequências); até lá ele é opcional e desligado.

## Consequências
- O ADR-002 não muda: B apenas ocupa a camada opcional que ele já previa. Não é preciso substituí-lo.
- Antes de ligar por padrão, repetir os critérios de geração com o prompt de B (Fase 4, laboratório, FR-12). Se o p50 de B passar de 20 s, o LLM volta a ser opcional e desligado.
- Testes de regra de negócio continuam sem LLM real (NFR-04). Casos de injection (T-05, critérios a/b/c) entram na suíte da Fase 4 com mais de 2 casos.
- Modelo fora do ar: chamados, KB, busca e painel determinístico funcionam, com aviso na interface (FR-13).
- A opção C ficou descartada. Se for retomada, precisa de ADR novo que diga como o campo `suficiente` do modelo se combina com o limiar e que revise o ADR-002.
- Checklist da re-medição (ver AI_EVALUATION.md, "Como medir a geração"): `pnpm eval --llm` no Ollama do autor, digest do modelo registrado, p50 aquecido, citações, injeção e leitura humana dos critérios b e c.
