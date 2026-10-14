# Checklist de release

Gate da Fase 5 (ARCHITECTURE §8). Cada linha vem da coluna "Teste que prova" do THREAT_MODEL ou do PRD; nada aqui é novo requisito. A coluna **Estado** diz só o que foi executado, com a data; "pendente" não é "falhou". Refaça tudo na `main`, depois que os PRs da Fase 5 forem mesclados.

Última atualização: 2026-10-12. **Estado** registra execuções locais minhas desse dia, sem a saída bruta anexada: quem for liberar o release deve rodar a coluna **Como** de novo na `main` e colar a saída. Os números de testes são os de cada branch no momento do commit, não da `main`.

## Automático (rode e cole a saída)

| Item | Ref. | Como | Estado |
| --- | --- | --- | --- |
| Lint e tipos | CLAUDE.md | `pnpm lint && pnpm typecheck` | verde ao commitar cada branch da Fase 5 (não verificado na `main` depois dos merges) |
| Testes de API, web, avaliação e Semana 0 | PRD §3 e §4 | `pnpm test` (precisa do Postgres do compose e do `.env.test`) | verde: api 346, web 131, evaluation 70, semana0 77 (branch `fix/ordem-do-historico`) |
| Matriz de visibilidade e IDOR | T-01, T-02, T-06 | dentro do `pnpm test` (`apps/api/test`) | verde, junto com o item acima |
| e2e no navegador | T-12, NFR-06 | `pnpm exec playwright install chromium` e `pnpm test:e2e` (apaga o schema do `nexus_test`; não rode junto com `pnpm test`) | 9 de 9 verde em 2026-10-12, local. **Job do CI ainda não rodou no GitHub** |
| Workflows e compose | T-10, T-17 | `workflows.test.ts` e `images-pinned.test.ts` (em `pnpm test`) | verde na branch `ci/scans` |
| Auditoria de dependências | T-09 | `pnpm audit --prod --audit-level=high` (job `checks` do CI) | pendente: não rodei localmente nesta sessão |
| Segredos | T-08 | job `secrets` (Gitleaks) do CI | pendente: o Gitleaks não existe nesta máquina; falta o PR com segredo falso que prova o job (RUNBOOK, drill 2) |
| Trivy (Dockerfile) e CodeQL | T-10, T-17 | jobs `trivy` e workflow `codeql.yml` | Trivy 0.70.0 local: 0 achados HIGH/CRITICAL no Dockerfile. **CodeQL e o job do Trivy ainda não rodaram no GitHub** |
| Imagem da API sobe como não-root | T-10 | `docker build -f apps/api/Dockerfile -t nexus-api:ci .` e `docker run --rm --entrypoint id nexus-api:ci -u` (diferente de 0) | UID 1000 em 2026-10-12 |

## Manual (faça e anote a data)

| Item | Ref. | Como | Estado |
| --- | --- | --- | --- |
| Restore em banco vazio | T-14 | RUNBOOK, drill 1 | feito em 2026-10-12: origem e destino coincidem (11 tabelas, 3 usuários, 9 migrações), sessões 0 no restaurado. Refazer na `main`: ela tem 9 migrações; a 10ª entra com a branch `fix/ordem-do-historico` |
| Segredo vazado | T-08 | RUNBOOK, drill 2 | roteiro; não executado |
| Modelo fora do ar | T-12, FR-13 | RUNBOOK, drill 3 | executado de forma automatizada em 2026-10-13: o e2e sobe a API com `LLM_ENABLED=true` e o Ollama apontado para uma porta fechada, `llm-fora-do-ar.spec.ts` confere o painel (fontes, passos e o aviso) e o resto do e2e (14 testes) passou nessa configuração. Prova a recusa de conexão; timeout e erro 5xx estão em `diagnosis.test.ts`. Não foi feito com o Ollama real parado |
| Licenças dos pacotes | T-13 | `pnpm licenses list --json` | 2026-10-12: MIT 275, Apache-2.0 16, ISC 15, BSD-2-Clause 8, BSD-3-Clause 4, MIT-0 2, MPL-2.0 2, BlueOak-1.0.0 2, CC0-1.0 1; nenhum GPL/AGPL. Produção: MIT 93, ISC 6, BSD-3-Clause 1 |
| Licenças dos modelos | T-13 | `ollama show <modelo> --license` | `bge-m3`: MIT. `qwen3.5:4b`: Apache-2.0. `gemma3:4b`: **Gemma Terms of Use** (termos próprios do Google, com política de uso aceitável; não é licença livre). O repositório não distribui pesos, o usuário os puxa pelo Ollama; leia os termos antes de publicar uma demo que use o Gemma |
| Revisão dos workflows | T-17 | ler `.github/workflows/*.yml` | revisado por agente de segurança em cada PR; revisão humana pendente |
| Contraste e reflow, medidos | NFR-06 | `pnpm test:e2e` (`a11y.spec.ts`, `demo-a11y.spec.ts`; a medição é testada em `a11y-medicao.spec.ts`) | medido no navegador em 2026-10-13: contraste AA (4,5:1 no texto e no texto digitado, 3:1 na borda dos campos, com a opacidade herdada) sem falhas nas telas varridas; reflow em 320 px sem rolagem horizontal da página, depois de corrigir o laboratório (278 px; causa: texto `sr-only` absoluto fora do recorte). **Telas varridas:** login, meus chamados, novo chamado e base do solicitante (pilha real); início, fila, detalhe com diagnóstico, base, artigo e laboratório do técnico (demo estática, com os dados gravados). **Não coberto:** estados de erro e vazios, foco e hover, erros de formulário, pseudo-elementos e placeholders, ícones, 400% de zoom de texto, modo escuro, alto contraste |
| Acessibilidade manual | NFR-06 | teclado, leitor de tela (VoiceOver) e zoom 200% nas telas críticas | pendente: há teste automatizado de foco e papéis e as medições acima; o leitor de tela e o zoom de texto são manuais |
| Demo estática funciona | ADR-003, PRD §5 | `pnpm test:e2e` (projeto `demo`: build + navegador, sem API) e `pnpm demo:record` se os dados mudarem | build e teste de navegador verdes em 2026-10-12, local; gravação de 85 respostas (14 chamados, 30 artigos, 4 diagnósticos); **não publicada** |
| README confere com a realidade | PRD §5 | seguir o README do zero num clone limpo (NFR-02) | pendente |

## Fora deste gate

- Conjunto de teste congelado, avaliação nele e recalibração do limiar (`DIAGNOSIS_THRESHOLD_TRUSTED` fica `false`): só o autor (CLAUDE.md, "Fase atual").
- Vídeo de 2 a 3 minutos (PRD §5): o autor pediu em 2026-10-12 para não ser feito por Claude.
- Publicar a demo estática (ADR-003): o build existe (`pnpm build:demo`) e tem teste de navegador; escolher o endereço e publicar é uma ação externa e pede confirmação do autor.
