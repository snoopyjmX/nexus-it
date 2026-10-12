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

### Notas sobre esta primeira medição
- O lexical do app junta os termos com OR; o lexical da Semana 0 usava AND (`plainto_tsquery`) e zerava as paráfrases (0/10). Não comparar os dois sem dizer isso.
- Só o modo lexical foi medido. O vetorial (bge-m3) depende do Ollama do autor: rodar `EMBEDDINGS_ENABLED=true pnpm eval` e registrar uma linha nova aqui.
- O conjunto dev foi escrito por IA e aprovado pelo autor (ver `semana0/dados/AUTORIA.md`); com 30 consultas, diferença de 1 ou 2 casos é ruído. O conjunto de teste ainda não existe.
- Sem ordenação por empate fixa, duas execuções dariam MRR diferente nas paráfrases (0,754 e 0,762); o runner semeia ids estáveis para a medição ser reproduzível (ADR-012).
