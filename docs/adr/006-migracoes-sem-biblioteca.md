# 006. Runner de migrações próprio, só com SQL

Data: 2026-10-10 · Status: proposto

## Contexto
O projeto usa SQL explícito com o driver `pg` (ADR-005). As migrações precisam ser reproduzíveis num banco vazio (NFR-02) e seguras se dois processos subirem juntos.

## Opções consideradas
- Biblioteca de migração (ex.: node-pg-migrate): pronta, com "down" / mais uma dependência e uma DSL a aprender.
- Runner próprio de ~50 linhas: arquivos `.sql` numerados, cada um numa transação, registrados em `schema_migrations`, com `pg_advisory_lock` contra concorrência.

## Decisão
Runner próprio, sem "down": para desfazer, cria-se uma nova migração.

## Consequências
Fácil de explicar e testar (teste de integração com Postgres real cobre banco vazio e idempotência). Sem rollback automático; se o projeto crescer muito, reavaliar uma biblioteca.
