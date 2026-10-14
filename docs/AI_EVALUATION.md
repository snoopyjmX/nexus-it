# NEXUS IT — Avaliação da busca e do diagnóstico

Versão 2.0 · 2026-10-10. Resultados são preenchidos à medida que são medidos. Nenhum número aqui é meta atingida até ter data, versão e saída bruta registradas.

## Conjuntos

- **dev** (`packages/evaluation/dataset/dev/`): os casos da Semana 0. Pode orientar ajustes de prompt, limiar e busca.
- **teste** (`packages/evaluation/dataset/test/`): escrito depois, congelado, com hash registrado neste arquivo. Só roda para relatar. Protegido contra edição pelo Claude Code (hook).
- Cerca de 30 casos por conjunto, crescendo até ~50. É uma suíte de regressão exploratória, não prova estatística.

## Eixos e métricas

| Eixo | Métrica | Como interpretar |
| --- | --- | --- |
| Recuperação | Hit@1, Hit@5, MRR por tipo e categoria, em contagens | Com uma fonte esperada por consulta, Recall@5 = Hit@5. Diferenças de 1–2 casos são ruído |
| Citação | % de IDs retornados válidos e permitidos | Deve ser 100%, garantido pelo servidor |
| Citação correta | Cita a fonte esperada? | Contagem sobre os respondíveis |
| Sustentação | Cada afirmação: suportada / não suportada / contradita | Rubrica com exemplos; reportar quantos casos foram revisados e por quem |
| Correção | Hipóteses incluem a causa esperada? | Diferente de sustentação: fonte certa não garante diagnóstico certo |
| Abstenção | Sem-resposta em que não afirma solução | Calibrado num grupo, validado em outro |
| Injection | Ataque teve sucesso pelos critérios a/b/c (T-05)? | Qualquer "sim" é defeito |
| Custo | Latência p50/p95 fria e aquecida; memória | Sempre com hardware, modelo, ID e parâmetros |

## Vieses declarados

- O autor escreve artigos e consultas, o que favorece a busca lexical. Mitigação: consultas escritas antes dos artigos; se possível, um colega escreve parte das paráfrases.
- Revisão de sustentação feita pelo autor. Quando possível, um segundo revisor confere uma amostra.
- Resultados negativos são publicados.

## Resultados

| Data | Conjunto (hash) | Configuração | Resultado | Saída bruta |
| --- | --- | --- | --- | --- |
| 2026-10-12 | dev (`6593b3ab29a9`, 30 consultas) | `pnpm eval`, busca lexical do app (OR dos termos, `ts_rank_cd`), commit `beca538`, Xeon 2,1 GHz / 8 GB (sandbox de desenvolvimento, não o Mac do autor) | Hit@1 · Hit@5 sobre as consultas com resposta: diretas 8/8 · 8/8; paráfrases 7/10 · 8/10; ambíguas 1/2 · 2/2; injection 2/2 · 2/2. Abstenção por score lexical (limiar 1,65 calibrado em 4 sem-resposta): abstém 2/4 na calibração e 2/4 na validação, sem perder respondíveis | `packages/evaluation/results/2026-10-12T03-58-48-dev-lexical.json` |
| 2026-10-12 | dev (`6593b3ab29a9`), casos de geração `b08ee9fda72a` | `pnpm eval --llm` (3 rodadas), busca lexical, `gemma3:4b` (ID `68ceab7e468a` no `ollama list`), prompt `resumo-v1`, commit `e361c5d` com as edições locais de porta do autor, Intel i7-9750H 2,6 GHz / 16 GB, macOS (Mac do autor) | Cita a fonte esperada: 7 de 8 (critério ≥ 6: atende). Marcador de injection no texto: 0 (atende; o trecho plantado chegou ao modelo em 1 de 2 casos, só esse testa a resistência). Estável nas rodadas: 10 de 12 (atende). **p50 aquecido 26,8 s contra o critério de 20 s: NÃO atende** (p95 38,3 s; 1ª chamada 44,0 s). 36 chamadas, todas `ok`, 0 citações descartadas. Dos 2 sem-resposta, 0 foram recusados antes de chamar o modelo. Critérios b e c do T-05 aguardam leitura humana dos resumos | `packages/evaluation/results/2026-10-12T16-05-06-dev-lexical.json` |
| 2026-10-12 | dev (`6593b3ab29a9`, 30 consultas) | `EMBEDDINGS_ENABLED=true EMBEDDING_TIMEOUT_MS=120000 pnpm eval`, busca vetorial do app (`bge-m3`, cosseno), commit `6bbf795`, Intel i7-9750H 2,6 GHz / 16 GB, macOS (Mac do autor) | Hit@1 · Hit@5 sobre as consultas com resposta: diretas 8/8 · 8/8; paráfrases 10/10 · 10/10; ambíguas 2/2 · 2/2; injection 2/2 · 2/2 (MRR 1,000 em todos os tipos). Abstenção no limiar configurado 0,5393: abstém 7 de 8 sem-resposta e perde 0 de 22 respondíveis (calibração 4/4 e validação 3/4, os mesmos números da Semana 0). **Não é validação independente**: é o mesmo conjunto em que o limiar foi calibrado e que a mesma IA escreveu. Nenhum limiar foi alterado | `packages/evaluation/results/2026-10-12T19-18-36-dev-vector.json` |

### Notas sobre a medição da busca (primeira linha)
- O lexical do app junta os termos com OR; o lexical da Semana 0 usava AND (`plainto_tsquery`) e zerava as paráfrases (0/10). Não comparar os dois sem dizer isso.
- Só o modo lexical foi medido. O vetorial (bge-m3) depende do Ollama do autor: rodar `EMBEDDINGS_ENABLED=true pnpm eval` e registrar uma linha nova aqui.
- O conjunto dev foi escrito por IA e aprovado pelo autor (ver `semana0/dados/AUTORIA.md`); com 30 consultas, diferença de 1 ou 2 casos é ruído. O conjunto de teste ainda não existe.
- Sem ordenação por empate fixa, duas execuções dariam MRR diferente nas paráfrases (0,754 e 0,762); o runner semeia ids estáveis para a medição ser reproduzível (ADR-012).

### Notas sobre a medição vetorial
- A primeira tentativa abortou: com o timeout padrão de embedding (15 s), 16 dos 40 documentos não receberam vetor nesta CPU (Intel, só CPU, contexto 8192). O runner recusa publicar um modo vetorial incompleto, e a execução válida usou `EMBEDDING_TIMEOUT_MS=120000` (o máximo). Em hardware parecido, o padrão de 15 s não basta para o backfill.
- A mesma medição lexical repetida em outro commit (`6bbf795`, `2026-10-12T19-18-36-dev-lexical.json`) deu números idênticos aos da primeira linha, o que mostra que ela é reproduzível.
- Abstenção vetorial com `DIAGNOSIS_THRESHOLD_TRUSTED=false` (padrão): o app **não** aplica o corte; só o harness o avalia. Ligar o corte é decisão do autor, depois da recalibração.

### Notas sobre a medição da geração
- Duração por caso, Semana 0 contra Fase 4 (mesmo modelo, mesmos parâmetros do Ollama, mesmo notebook): a Semana 0 mandou **3 fontes** ao modelo e a Fase 4 manda **5** (`SOURCES_MAX`); nos casos comuns a mediana subiu cerca de 30% (por exemplo q01: 19,8 s contra 26,8 s). Nos 2 casos sem resposta, a Semana 0 recusava antes de gerar (6 a 8 s) e a Fase 4, com busca lexical, devolve fontes e o modelo gera o resumo inteiro (33 a 36 s). É uma comparação dos dados existentes, não um experimento controlado.
- Uma tentativa de testar a hipótese limitando o prompt a 3 fontes (patch local, descartado) **não é utilizável**: 6 chamadas deram timeout, houve um tempo de 3.667.716 ms e a estabilidade caiu para 6/12. A máquina estava com carga 28 em 12 threads e tem 70 ciclos de suspensão desde o boot. **Nenhuma medição de latência feita neste Mac nessas condições é confiável**, inclusive a de 26,8 s. Para uma medição defensável: fechar os outros aplicativos, manter o Mac acordado (`caffeinate -i pnpm eval --llm --rounds 5`) e conferir a carga antes e depois.

## Como medir a geração do resumo (ADR-008, ADR-012)
Precisa do Ollama do autor com o modelo puxado (`LLM_MODEL`, padrão `gemma3:4b`) e do banco migrado.
1. `pnpm eval --llm` (3 rodadas) ou `pnpm eval --llm --rounds 5`. Com `EMBEDDINGS_ENABLED=true`, a geração é medida sobre a busca vetorial; sem ele, sobre a lexical.
2. Registre na tabela de Resultados: data, hash do conjunto, hash dos casos de geração, modelo **e digest** (`ollama list`), versão do prompt, commit, hardware, p50/p95 aquecidos e a saída bruta (`packages/evaluation/results/`).
3. Critérios automáticos no relatório: cita a fonte esperada (≥ 6 de 8), zero marcadores vazados, p50 aquecido ≤ 20 s, estável (≥ 10 de 12). Se o p50 passar de 20 s, o ADR-008 manda manter o LLM opcional e desligado.
4. Leia os resumos (tela Laboratório → "Resumos gerados, caso a caso") para os critérios b e c do T-05. Só valem os casos em que o trecho plantado chegou ao modelo.
5. Primeira medição com modelo real: ver a linha de 2026-10-12 na tabela. O p50 aquecido (26,8 s) passou do critério de 20 s, então, pelo ADR-008, o resumo do modelo segue opcional e desligado (`LLM_ENABLED=false`). A Semana 0 tinha medido 18,4 s com o mesmo modelo no mesmo notebook (`docs/CASE-SEMANA0.md`); veja "Notas sobre a medição da geração" abaixo: a diferença coincide com 5 fontes no prompt em vez de 3, mas a causa não foi confirmada.
