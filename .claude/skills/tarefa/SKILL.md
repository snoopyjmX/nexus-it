---
name: tarefa
description: Executa uma tarefa do NEXUS IT de ponta a ponta a partir de um ID de requisito (ex. /tarefa FR-03).
disable-model-invocation: true
argument-hint: "[ID do requisito, ex. FR-03]"
---

Tarefa: implementar o requisito $ARGUMENTS.

Siga exatamente estes passos e pare para me mostrar o resultado nos pontos marcados com PAUSA.

1. Leia $ARGUMENTS em docs/PRD.md e as seções relacionadas em docs/ARCHITECTURE.md e docs/THREAT_MODEL.md. Resuma em 3 a 5 linhas o que precisa ser feito, o que está fora do escopo e quais arquivos devem mudar. PAUSA.
2. Use o subagente test-author para escrever os testes que falham para $ARGUMENTS. Mostre a saída da falha. PAUSA.
3. Implemente o mínimo de código para os testes passarem. Antes de usar qualquer API de biblioteca que você não tenha certeza da assinatura, consulte a documentação atual com context7.
4. Rode /verify e mostre a saída.
5. Rode /revisar e corrija os achados críticos e importantes. Rode /verify de novo.
6. Liste: arquivos alterados, testes que provam o requisito, decisões tomadas e qualquer dúvida em aberto. Sugira a mensagem de commit no formato `feat(<módulo>): <resumo> [$ARGUMENTS]`. Não faça commit sem eu pedir.
