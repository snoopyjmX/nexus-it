# 002. Diagnóstico determinístico primeiro; LLM opcional

Data: 2026-10-10 · Status: aceito

## Contexto
O plano original delegava ao LLM decidir quando não há evidência e gerar os próximos testes. Modelos pequenos locais tendem a responder mesmo sem base, e o comportamento mais importante do produto ficaria imprevisível e difícil de testar na CI.

## Opções consideradas
- LLM decide abstenção e passos: mais "inteligente" / imprevisível, não testável sem modelo.
- Regra decide (limiar de score + passos do campo `procedure` das fontes), LLM só resume: previsível e testável / depende de um limiar calibrado.

## Decisão
Abstenção primária por limiar de score calibrado num grupo e validado em outro; próximos testes extraídos do procedimento das fontes. O LLM é uma camada opcional que só entra se passar nos critérios da Semana 0. Score não é tratado como probabilidade.

## Consequências
O produto funciona com o LLM desligado e a CI testa tudo com provider mock. Sem limiar confiável, o painel rotula fontes como "evidência não verificada" e nunca mostra porcentagem.
