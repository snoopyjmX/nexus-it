# Regras de segurança do NEXUS IT

- Toda leitura ou escrita de chamado, comentário, evento ou artigo por ID passa pelo módulo de política (`scopeTicketsFor`, `scopeArticlesFor`, `can`). Recurso de outro usuário retorna 404.
- Listagem, busca (`/search`) e montagem de contexto do diagnóstico usam a MESMA função de escopo. Filtro de permissão escrito à mão dentro de uma rota é achado.
- Solicitante nunca recebe artigo em rascunho nem chamado de outro usuário, nem pela busca. Chamados só entram no contexto da IA se estiverem resolvidos.
- Campos `role`, `requester_id`, `author_id`, `status` e `version` nunca são aceitos do corpo da requisição; vêm da sessão ou de regras do servidor. Schemas Zod usam `.strict()` e são diferentes por papel.
- Status do chamado só muda por `POST /tickets/:id/transitions`, validado pela tabela de transições.
- Sessão: cookie `HttpOnly`, `Secure`, `SameSite=Lax`; ID regenerado no login; só o hash do token no banco; token CSRF em todo método que altera estado. Nada de token em `localStorage`.
- Senha com Argon2id. Mensagem de login genérica. Rate limit em login, busca e diagnóstico.
- Logs nunca contêm senha, cookie, header Authorization, token ou corpo de chamado.
- Saída do modelo de linguagem é texto não confiável: renderizada como texto puro, IDs de fonte descartados se não estiverem na lista recuperada e permitida, sem URLs geradas pelo modelo.
- O modelo nunca decide permissão, nunca altera dados e não tem ferramentas.
- Erros da API em `application/problem+json`, sem stack trace nem SQL.
