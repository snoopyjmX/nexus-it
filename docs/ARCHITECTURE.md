# NEXUS IT — Arquitetura

Versão 2.0 · 2026-10-10. Decisões que mudaram estão em docs/adr/.

## 1. Visão geral

Monólito modular num monorepo pnpm: `apps/web` (React) e `apps/api` (Express) separados, um único PostgreSQL (transações, full-text e vetores) e o modelo local (Ollama, no host) atrás de um adaptador. Só a API toca no banco e monta o contexto da IA. O modelo não tem credenciais nem ferramentas.

```
apps/web               React + TS + Vite + Tailwind + TanStack Query
apps/api               Express 5 + TS + Zod
  src/modules/         auth, tickets, knowledge, search, diagnosis, evaluation
  src/policy/          can(), scopeTicketsFor(), scopeArticlesFor()  ← único lugar de autorização
  src/lib/             db, logger, errors (problem+json), config (Zod no boot)
packages/contracts     schemas Zod compartilhados — entra na Fase 2, com o primeiro DTO real
packages/evaluation    dataset/dev, dataset/test (congelado), métricas, runner CLI (ADR-012)
infra/                 Dockerfiles, compose
docs/                  PRD, ARCHITECTURE, THREAT_MODEL, AI_EVALUATION, SEMANA0, RUNBOOK, adr/
scripts/               seed, create-user, backup, restore
```

**Camadas por módulo:** rota (HTTP + Zod) → serviço (regras + política) → repositório (SQL parametrizado). A rota não toca no banco; o repositório não decide permissão. Regras de domínio (transições, política, montagem do diagnóstico) são funções puras testáveis sem banco.

**Configuração** validada com Zod na inicialização: variável faltando derruba o processo na hora. **Erros** passam por um handler central que gera `application/problem+json` (RFC 9457) sem stack trace.

**Ollama no host, não no Docker:** a API alcança o host por `host.docker.internal`. No macOS, rodar o Ollama dentro do Docker tende a perder aceleração de GPU (registrar em ADR quando medido).

## 2. Modelo de dados

| Tabela | Campos principais | Nota |
| --- | --- | --- |
| `users` | id, email, display_name, password_hash, role, active, created_at | role ∈ {requester, technician}. Criado só por seed/CLI. |
| `sessions` | id_hash, user_id, expires_at, idle_expires_at, created_at | Store de sessão em Postgres; só o hash do token. O token CSRF é derivado do token da sessão (ADR-009), sem coluna própria. |
| `tickets` | id, title, description, category, priority, status, requester_id, assignee_id, resolution_note, version, embedding, embedding_model, created_at, updated_at, resolved_at | `embedding` preenchido só quando resolvido (ADR-001). |
| `ticket_comments` | id, ticket_id, author_id, body, created_at | |
| `ticket_events` | id, ticket_id, actor_id, event_type, payload, created_at | Append-only; payload em allow-list. |
| `kb_articles` | id, title, symptom, environment, procedure, expected_result, status, version, author_id, embedding, embedding_model, created_at, updated_at | status ∈ {draft, published}. Editar publicado = republicar (versão +1). |
| `kb_tags`, `kb_article_tags` | | |
| `ai_runs` | id, ticket_id, user_id, mode, search_mode, degraded, retrieved, abstained, evidence, duration_ms, feedback_useful, feedback_note, feedback_at, feedback_by, llm_model, llm_prompt_version, llm_outcome, llm_discarded_citations, created_at | mode ∈ {deterministic, llm}; evidence ∈ {threshold, unverified}, nula quando abstém. Só ids e desfecho: nunca o texto do chamado, das fontes ou do contexto (ADR-011). Colunas do modo LLM: modelo, versão do prompt, desfecho (ok, provider_error, invalid_output, uncited) e citações descartadas; o texto do resumo não é gravado. mode = llm só quando o resumo foi mostrado. |
| `eval_runs` | id, created_at, dataset_set, dataset_version, search_mode, embedding_model, llm_model, prompt_version, environment, result | Só o runner (`pnpm eval`) grava; a API só lê. dataset_version = hash de 12 hexadecimais dos arquivos do conjunto; vector exige embedding_model; llm_model e prompt_version vêm em par (ADR-012). |

**Busca lexical (FR-07):** coluna `search` gerada (`tsvector` com `portuguese` e `f_unaccent`; pesos título A, sintoma B, ambiente e procedimento C, resultado esperado D) e índice GIN. A consulta usa `plainto_tsquery` com os termos unidos por OU e ordena por `ts_rank_cd`, desempatando por id, porque o E da Semana 0 zerava as paráfrases. A resposta traz `mode: "lexical"`. Entram artigos publicados (qualquer papel) e chamados resolvidos ou fechados (solicitante: só os próprios; técnico: todos); reabrir tira o chamado da busca. Cada item traz `kind`. Os scores de artigo e de chamado vêm de colunas diferentes e só são comparáveis de forma aproximada.

**Busca vetorial (ADR-007, `EMBEDDINGS_ENABLED=true`):** bge-m3 (1024 dimensões), cosseno exato sem índice ANN; `score = 1 − distância`, cortado em `VECTOR_MIN_SCORE`. A resposta traz `mode: "vector"`. O embedding é calculado antes da transação; se o Ollama estiver fora do ar, publicar/resolver grava vetor NULL, a busca cai para lexical (`mode: "lexical"`, `degraded: true`) e `GET /search/status` (técnico) conta os vetores pendentes. `pnpm embeddings:backfill` preenche os que faltam. CHECKs no banco garantem FR-15: vetor só em artigo publicado e chamado resolvido/fechado, e `embedding`/`embedding_model` sempre juntos ou ambos NULL.

**Sem tabela de chunks (ADR-001):** 1 artigo = 1 vetor na própria linha. A busca filtra `status = 'published'` (artigos) ou `status IN ('resolved','closed')` (chamados) na mesma query, então despublicar exclui por construção. O embedding é recalculado na transação que publica/resolve.

`version` em `tickets` e `kb_articles` implementa concorrência otimista: PATCH sem a versão atual → 409.

## 3. Máquina de estados do chamado

Estados: `open`, `in_progress`, `waiting_requester`, `resolved`, `closed`, `cancelled`. `closed` e `cancelled` são terminais.

| De → Para | Quem pode | Exige |
| --- | --- | --- |
| open → in_progress | Técnico | Responsável definido (ele mesmo por padrão) |
| open → cancelled | Solicitante dono ou técnico | — |
| in_progress → waiting_requester | Técnico | Comentário com o que falta |
| waiting_requester → in_progress | Solicitante dono (ao responder) ou técnico | — |
| in_progress → resolved | Técnico | Nota de resolução obrigatória |
| resolved → in_progress | Solicitante dono (reabrir) | Motivo |
| resolved → closed | Solicitante dono ou técnico | — |

Implementação: tabela de dados numa função pura (`canTransition(from, to, actor, ticket) → ok | erro`). Cada linha da tabela é um teste. Toda transição grava evento na mesma transação. Respostas: aresta fora da tabela → 422; aresta existente mas perfil sem permissão → 403 (o chamado já é visível ao ator); comentário ou nota exigidos ausentes → 400; versão desatualizada no PATCH → 409. O evento guarda só origem e destino, nunca texto livre.

## 4. Endpoints

Princípios: tudo sob `/api/v1`; escopo decidido pela sessão, nunca por parâmetro do cliente; recurso alheio → 404; status só por endpoint de transição; erros problem+json; listas com paginação por cursor; avaliação por CLI, não por endpoint.

| Método e rota | Papel | Regra de dono |
| --- | --- | --- |
| `POST /auth/login` | Público | Rate limit por IP e por conta |
| `POST /auth/logout`, `GET /auth/me` | Autenticado | Própria sessão; `/me` entrega o token CSRF |
| `GET /tickets` | Ambos | Solicitante: só os próprios. Técnico: todos, com filtros |
| `POST /tickets` | Solicitante | Dono = sessão, nunca vem do corpo |
| `GET /tickets/:id` | Ambos | Solicitante: só o próprio; senão 404 |
| `PATCH /tickets/:id` | Ambos | Solicitante: título/descrição só em `open`. Técnico: prioridade, categoria, responsável. Schema por papel; `version` obrigatório |
| `POST /tickets/:id/transitions` | Ambos | Tabela de transições (§3) |
| `GET`/`POST /tickets/:id/comments` | Ambos | Segue a visibilidade do chamado |
| `GET /tickets/:id/events` | Ambos | Segue o chamado; payload em allow-list |
| `POST /tickets/:id/diagnosis` | Técnico | Rate limit; 1 execução simultânea por usuário |
| `POST /diagnosis-runs/:id/feedback` | Técnico | Corpo `{ useful, correction? }`; grava só na execução, nunca em artigo ou chamado |
| `GET /articles`, `GET /articles/:id` | Ambos | Solicitante: só publicados; rascunho = 404 |
| `POST /articles`, `PATCH /articles/:id` | Técnico | `version` obrigatório no PATCH |
| `POST /articles/:id/publish`, `/unpublish` | Técnico | Recalcula/limpa embedding na mesma transação |
| `GET /search?q=` | Ambos | Escopo pelo papel, no servidor |
| `GET /eval/runs` | Técnico | Só leitura; 50 execuções mais recentes de `eval_runs` |
| `GET /health/live`, `/health/ready` | Público | Sem detalhes internos |

## 5. Matriz de visibilidade

| Fonte | Solicitante (tela/API) | Solicitante (busca) | Técnico (tela/API) | Contexto do diagnóstico |
| --- | --- | --- | --- | --- |
| Chamado próprio | ✓ | ✓ | ✓ | Só se resolvido/fechado |
| Chamado alheio | ✗ (404) | ✗ | ✓ | Só se resolvido/fechado |
| Comentários e eventos | Seguem o chamado | ✗ | ✓ | ✗ |
| Artigo em rascunho | ✗ (404) | ✗ | ✓ | ✗ |
| Artigo publicado | ✓ | ✓ | ✓ | ✓ |
| Execuções de diagnóstico | ✗ | ✗ | ✓ | — |
| Resultados de avaliação | ✗ | ✗ | ✓ | — |

Implementação: um único módulo `src/policy/` usado pela listagem, pela busca e pela montagem do contexto. A matriz vive também como arquivo de dados (`policy/visibility-matrix.ts`) e o teste percorre cada célula.

## 6. Diagnóstico (determinístico primeiro — ADR-002)

1. Técnico pede diagnóstico; servidor checa sessão e papel. Limite de 10 por minuto e 1 em andamento por usuário (429).
2. Consulta = título e descrição do chamado, espaços normalizados, no máximo 300 caracteres (ADR-011).
3. Busca top-5 com escopo do técnico (artigos publicados + chamados resolvidos), a mesma de `GET /search`; o próprio chamado fica de fora.
4. Busca vetorial com limiar confiável: nada a partir do limiar → abstenção ("evidência insuficiente"); fim, sem LLM. Busca por palavras (embeddings desligados ou fora do ar, com `degraded: true`) ou limiar não confiável (`DIAGNOSIS_THRESHOLD_TRUSTED=false`, o padrão até a recalibração do ADR-007): sem corte, fontes rotuladas "evidência não verificada"; sem nenhuma fonte, também abstém. A resposta nunca traz score.
5. Painel determinístico: fontes ranqueadas com link + passos extraídos do `procedure` dos 3 primeiros artigos entre as fontes (chamados resolvidos são fontes, sem passos).
6. Se o LLM estiver habilitado (`LLM_ENABLED`) e houver evidência: contexto delimitado como dado não confiável, rótulos F1..Fn no lugar de ids, saída JSON validada por schema estrito, citações fora da lista descartadas e contadas, resumo sem citação válida descartado, texto renderizado como texto puro e rotulado "gerado" (ADR-011 item 8). Falha do modelo não altera o resto da resposta (`llm: "unavailable"`).
7. Grava `ai_runs` sem contexto bruto.

## 7. Telas

**Solicitante:** login · meus chamados · novo chamado · detalhe do chamado (status, conversa, histórico; responder, confirmar, reabrir) · base de conhecimento (busca e leitura).

**Técnico:** fila (filtros por status, prioridade, categoria, responsável) · detalhe do chamado com painel de diagnóstico ao lado · gestão da base (lista com rascunhos, editor, publicar/despublicar) · laboratório (só leitura).

**Comum:** estados de carregando, vazio e erro; página de não encontrado. Guards de rota no frontend são só UX; quem protege é a API.

## 8. Fases

| Fase | Entrega | Gate |
| --- | --- | --- |
| 0 · Semana 0 | Experimento (docs/SEMANA0.md), em repositório separado | Decisões de busca, limiar e LLM registradas |
| 1 · Fundação | Monorepo, Compose, CI rápido, config, logger, erros, sessão + CSRF + rate limit, seed/CLI de usuários | Clone limpo sobe; CI verde sem segredo real; testes de sessão passam |
| 2 · Chamados, KB, busca lexical | Módulos A, B, C (lexical), política + matriz completa, telas | Matriz de autorização e visibilidade 100% verde |
| 3 · Dataset e busca | Corpus completo, conjunto teste congelado, vetorial/híbrida se aprovada | Métricas no conjunto teste registradas |
| 4 · Diagnóstico e laboratório | Módulos D e E | Casos de abstenção e injection passam; citações 100% válidas |
| 5 · Hardening e apresentação | Scans, e2e, backup/restore, 3 drills, demo estática, vídeo, README | Checklist de release completo |
