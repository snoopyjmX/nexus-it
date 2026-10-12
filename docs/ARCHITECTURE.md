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
packages/evaluation    dataset/dev, dataset/test (congelado), métricas, runner CLI
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
| `ai_runs` | id, ticket_id, user_id, mode, model, prompt_version, retrieved_ids, abstained, output, duration_ms, error, feedback, created_at | mode ∈ {deterministic, llm}. Sem contexto bruto. |

**Busca lexical (FR-07):** coluna `search` gerada (`tsvector` com `portuguese` e `f_unaccent`; pesos título A, sintoma B, ambiente e procedimento C, resultado esperado D) e índice GIN. A consulta usa `plainto_tsquery` com os termos unidos por OU e ordena por `ts_rank_cd`, desempatando por id, porque o E da Semana 0 zerava as paráfrases. A resposta traz `mode: "lexical"`. Só artigos publicados entram, para qualquer papel. Busca em chamados resolvidos ainda não existe.

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
| `POST /diagnosis-runs/:id/feedback` | Técnico | — |
| `GET /articles`, `GET /articles/:id` | Ambos | Solicitante: só publicados; rascunho = 404 |
| `POST /articles`, `PATCH /articles/:id` | Técnico | `version` obrigatório no PATCH |
| `POST /articles/:id/publish`, `/unpublish` | Técnico | Recalcula/limpa embedding na mesma transação |
| `GET /search?q=` | Ambos | Escopo pelo papel, no servidor |
| `GET /eval/runs` | Técnico | Só leitura |
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

1. Técnico pede diagnóstico; servidor checa sessão e papel.
2. Consulta normalizada e limitada em tamanho.
3. Busca top-K com escopo do técnico (artigos publicados + chamados resolvidos).
4. Se o melhor score < limiar → abstenção ("evidência insuficiente"); fim, sem LLM.
5. Painel determinístico: fontes ranqueadas com link + passos extraídos do `procedure` das fontes.
6. Se o LLM estiver habilitado e disponível: contexto delimitado como dado não confiável, saída JSON validada por schema, IDs fora da lista descartados, texto renderizado como texto puro e rotulado "gerado".
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
