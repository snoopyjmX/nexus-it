---
name: verify
description: Roda lint, typecheck e testes do projeto e mostra a saída real. Use antes de cada commit e sempre que for afirmar que algo funciona.
---

Rode, nesta ordem, parando no primeiro que falhar:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. Se a mudança tocou em telas ou fluxos de ponta a ponta: `pnpm test:e2e`

Regras:
- Mostre o final da saída de cada comando (contagem de testes e falhas). Não resuma como "tudo passou" sem mostrar.
- Se algo falhar, corrija a causa e rode de novo. Nunca desative teste, regra de lint ou checagem de tipo para passar.
- Se o comando ainda não existir no projeto, diga isso em vez de pular em silêncio.
