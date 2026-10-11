# 004. Sessão em cookie com store em Postgres

Data: 2026-10-10 · Status: aceito

## Contexto
A web e a API rodam same-origin. É preciso logout real, expiração e proteção contra roubo de token por XSS.

## Opções consideradas
- JWT em localStorage: sem estado no servidor / revogação difícil, exposto a XSS.
- Sessão em cookie HttpOnly com store em Postgres: revogação simples, invisível ao JavaScript / exige CSRF e uma tabela de sessões.

## Decisão
Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, ID regenerado no login, só o hash do token no banco, token CSRF sincronizador em métodos que alteram estado. O store padrão em memória do express-session não é usado.

## Consequências
Logout invalida a sessão no servidor. Toda mutação precisa enviar o token CSRF obtido em `/auth/me`.
