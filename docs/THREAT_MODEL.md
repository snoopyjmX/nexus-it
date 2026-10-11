# NEXUS IT — Modelo de ameaças

Versão 2.0 · 2026-10-10. Princípio: negar por padrão; autorização no servidor; nenhum controle depende da UI nem do prompt. Ferramenta instalada não é prova: cada controle tem o teste que o comprova.

## Ativos

Credenciais e sessões · chamados, comentários e eventos · artigos (inclusive rascunhos) · respostas e fontes do diagnóstico · segredos de ambiente · integridade do pipeline e dependências · disponibilidade local frente a consultas caras.

## Fronteiras de confiança

Navegador ↔ API · API ↔ Postgres · API ↔ Ollama (saída do modelo é não confiável) · conteúdo de chamados/artigos ↔ prompt (texto do usuário é não confiável) · GitHub Actions ↔ repositório.

## Ameaças, controles e evidências

| ID | Ameaça | Controle | Teste que prova |
| --- | --- | --- | --- |
| T-01 | IDOR/BOLA em chamado | `scopeTicketsFor` em toda query; 404 para alheio | Matriz: 2 solicitantes × cada endpoint × ler/editar/comentar/eventos → 404. Rota nova sem caso falha a CI |
| T-02 | Escalada de papel | `can(user, action, resource)` no serviço | Solicitante chama rotas de técnico → 403 |
| T-03 | SQLi, XSS armazenado, mass assignment | SQL parametrizado; Zod `.strict()` por papel; React sem `dangerouslySetInnerHTML`; CSP | Payloads de injeção; campo extra `role`/`requester_id` → 400 |
| T-04 | Força bruta e abuso de custo | Rate limit em login, busca, diagnóstico; limite de corpo, texto, top-K, timeout; 1 diagnóstico simultâneo | Testes esperando 429 e timeout do provider |
| T-05 | Prompt injection | Contexto delimitado; sem tools; saída JSON validada; texto puro; próximos testes vêm do procedimento aprovado | Casos adversariais rotulados por critério (a) texto plantado aparece, (b) ação fora de procedimento aprovado, (c) ação destrutiva citada como evidência → todos "não" |
| T-06 | Vazamento via busca/RAG | Mesmo escopo para listagem, busca e contexto; filtro de status na própria linha | Matriz de visibilidade célula a célula; solicitante busca termo de chamado alheio e de rascunho → zero resultados |
| T-07 | Citação inventada | Servidor descarta ID fora da lista recuperada e permitida | Provider fake devolvendo IDs falsos → descartados e contados |
| T-08 | Segredo no Git | `.env` ignorado; `.env.example` sem valores; Gitleaks no pre-commit e na CI; deny de leitura de `.env` no Claude Code | Fixture com segredo falso falha a CI |
| T-09 | Dependência vulnerável | Lockfile congelado; Dependabot; `pnpm audit`; ADR para dependência nova | Audit na CI; exceções com prazo em ADR |
| T-10 | Container inseguro | Multi-stage; não-root; sem Docker socket; Postgres só em 127.0.0.1 | Trivy config + revisão no release |
| T-11 | Log vazando dados | Logger com redaction de authorization, cookie, password, token, body | Teste faz login e procura campos proibidos no log |
| T-12 | Modelo fora derruba o app | Timeout; erro tipado; diagnóstico determinístico independe do LLM | Ollama parado → e2e de chamados, KB e painel passa |
| T-13 | Licença incompatível | Revisão de licença de pacotes e modelos antes de publicar | Lista de licenças gerada no release |
| T-14 | Backup exposto ou que não restaura | Dumps fora do Git; restore testado | Restore em banco vazio no checklist de release |
| T-15 | Rascunho/despublicado no índice | Embedding na própria linha; filtro de status na query (ADR-001) | Despublicar → zero resultados nas buscas lexical e vetorial |
| T-16 | CSRF | Token sincronizador na sessão + `SameSite=Lax` + same-origin | Mutação sem token → 403 |
| T-17 | Pipeline comprometido | `permissions: contents: read`; actions por SHA; sem `pull_request_target`; CI sem segredo real | Revisão do workflow no release; Trivy/CodeQL |

## Autenticação e sessão

Argon2id (parâmetros em ADR, alvo de 100–500 ms medido no Mac, partindo do OWASP Password Storage Cheat Sheet vigente). Cookie `HttpOnly`, `Secure`, `SameSite=Lax`; ID regenerado no login; expiração absoluta e por inatividade; só hash do token no banco. Mensagem genérica e tempo uniforme no login; rate limit por IP e por conta. Headers: CSP restritiva, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.

## Riscos residuais declarados

O diagnóstico pode sugerir a fonte errada mesmo com tudo válido. Limiar de score é regra empírica do corpus, não probabilidade. Sem auditoria independente. Isso aparece no README e na UI.

## Como reportar uma vulnerabilidade

Abrir issue privada (Security Advisory) no repositório. Segredo vazado: revogar e rotacionar primeiro, depois limpar o histórico (RUNBOOK).
