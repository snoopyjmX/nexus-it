---
name: adr
description: Cria um novo ADR (registro de decisão de arquitetura) em docs/adr/ a partir de um título.
disable-model-invocation: true
argument-hint: "[título curto da decisão]"
---

Crie um ADR para: $ARGUMENTS

1. Veja o maior número em docs/adr/ e use o próximo (formato 3 dígitos, ex. 005).
2. Nome do arquivo: docs/adr/NNN-titulo-em-kebab-case.md
3. Use exatamente esta estrutura, curta (no máximo uma página):

```
# NNN. <Título>

Data: <AAAA-MM-DD> · Status: proposto

## Contexto
O problema e as restrições, em 2 a 4 frases.

## Opções consideradas
- Opção A: prós / contras
- Opção B: prós / contras

## Decisão
O que foi escolhido, em uma frase.

## Consequências
O que fica mais fácil, o que fica mais difícil, e o que precisa ser revisto e quando.
```

4. Não invente fatos sobre bibliotecas: se citar uma característica de uma ferramenta, confira na documentação atual.
5. Deixe o status como "proposto". Só eu mudo para "aceito".
