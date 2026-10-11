# 005. Dependências da Fase 1

Data: 2026-10-10 · Status: proposto

## Contexto
A Fase 1 precisa de servidor HTTP, validação, acesso ao Postgres, logs estruturados e testes. Cada dependência é superfície de ataque e manutenção (T-09).

## Opções consideradas
- Logger: `console` (sem estrutura nem redaction) / `pino` (JSON, redaction nativa por caminho) / `winston` (mais configurável, redaction manual).
- Acesso ao banco: ORM (abstrai o SQL que queremos mostrar e controlar) / query builder / driver `pg` com SQL parametrizado.
- Testes HTTP: subir servidor real / `supertest` sobre a app Express em memória.
- Versão do TypeScript: 7.0 (mais recente) / 6.0.x.

## Decisão
Runtime: `express` 5, `zod` 4, `pg` 8, `pino` 10. Desenvolvimento: `typescript` 6.0.3, `eslint` + `typescript-eslint`, `vitest`, `supertest`, `tsx`. Web: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`.
TypeScript fica em 6.0.x porque o `typescript-eslint` 8.71 exige `typescript <6.1`.
Não entram agora: helmet (4 cabeçalhos escritos à mão bastam), pino-http (log de requisição em 15 linhas), biblioteca de migração (ADR-006), Tailwind e TanStack Query (entram com as telas da Fase 2), pacote `contracts` (entra com o primeiro DTO compartilhado).

## Consequências
Imagem de produção com só 4 dependências diretas. Atualizar o TypeScript para 7 depende de o `typescript-eslint` suportá-lo; revisar a cada atualização do Dependabot.
