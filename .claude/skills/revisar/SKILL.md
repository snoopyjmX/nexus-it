---
name: revisar
description: Revisão independente do diff atual por dois subagentes (escopo/anti-slop e segurança). Use antes de cada commit.
---

## Arquivos alterados

!`git status --short || true`

## Instruções

1. Use o subagente scope-reviewer para revisar o diff atual.
2. Se algum arquivo alterado estiver em apps/api, .github/workflows, docker, ou envolver autenticação, sessão, política de acesso, busca ou diagnóstico, use também o subagente security-reviewer.
3. Junte os achados numa lista única, do mais grave ao menos grave, sem duplicatas.
4. Para cada achado, diga se você concorda e por quê. Não aplique correções que contrariem o PRD; nesses casos, pergunte.
5. Responda também ao checklist:
   - Atende ao requisito citado?
   - Há entrada sem validação ou autorização só na UI?
   - Pode vazar dado por ID, busca, log ou contexto da IA?
   - Adicionou dependência, script ou configuração aberta sem justificativa?
   - Os testes cobrem sucesso, falha, permissão e borda?
   - Existe forma mais simples?
