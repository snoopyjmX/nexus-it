# 011. Diagnóstico determinístico: consulta, abstenção, passos e registro

Data: 2026-10-12 · Status: proposto

## Contexto
O PRD (FR-09, FR-10, FR-11) e o ADR-002 definem o diagnóstico como regra: fontes ranqueadas, passos do `procedure`, abstenção por limiar. Falta fechar detalhes que mudam o comportamento: qual texto do chamado vira consulta, o que significa "limiar confiável", de onde saem os passos, quanto se registra e quais limites de uso valem. Estas decisões não vêm de medição; são escolhas de projeto, e as de números (K, limites) são arbitrárias dentro de um teto.

## Opções consideradas
- **Consulta:** só o título (curto, parecido com as consultas da Semana 0, mas perde detalhe) ou título + descrição inteira (mais informação, mas muito mais longo que o texto em que o limiar foi calibrado).
- **Limiar:** sempre aplicar o corte do vetorial / aplicar só quando houver uma decisão explícita de que ele é confiável.
- **Passos:** extrair de artigos e chamados resolvidos / só de artigos publicados. Chamado resolvido tem nota de resolução em texto livre, que não é "procedimento aprovado" (T-05).
- **Registro:** guardar a resposta inteira / guardar só ids e o desfecho.

## Decisão
1. **Consulta:** título e descrição do chamado com espaços normalizados, cortados em 300 caracteres. O limiar da Semana 0 foi medido em consultas curtas; textos mais longos podem mudar os scores, então a recalibração da Fase 3 deve usar chamados reais do conjunto de teste.
2. **Fontes:** a mesma busca de `GET /search`, com o escopo do técnico (reuso do módulo de política, T-06), até 5 fontes. O próprio chamado é excluído, pois um chamado resolvido apareceria como fonte de si mesmo.
3. **Abstenção:** com busca vetorial e limiar tratado como confiável (`DIAGNOSIS_THRESHOLD_TRUSTED`, padrão `true`, porque o critério de abstenção passou na Semana 0), só entram fontes com score a partir do limiar; sem nenhuma, o painel abstém ("evidência insuficiente"). Com busca por palavras (embeddings desligados ou Ollama fora do ar) ou com o limiar marcado como não confiável, não há corte: as fontes saem rotuladas "evidência não verificada"; sem nenhuma, também abstém. É o fallback do PRD (FR-10) e do `criterios.md`.
4. **Sem score na resposta.** Nem porcentagem nem valor bruto: score não é probabilidade e o ranking já diz a ordem.
5. **Passos:** só do campo `procedure` dos artigos publicados entre as fontes (até os 3 primeiros), extraídos por regra, sem reescrever. Chamados resolvidos aparecem como fontes, sem passos. O texto é sempre exibido como texto puro.
6. **Limites (T-04):** 10 diagnósticos por minuto por usuário e 1 em andamento por usuário, em memória (mesma ressalva do ADR-009: vale por processo). O 11º pedido e o pedido concorrente recebem 429.
7. **Registro (`ai_runs`):** quem pediu, qual chamado, modo da busca, ids recuperados, abstenção, evidência, duração e o feedback. Nunca o texto do chamado, das fontes ou dos passos. A correção do feedback é texto livre do técnico, de até 1000 caracteres, e não altera artigo nem chamado.

## Consequências
- O painel funciona sem LLM e sem Ollama. A CI testa tudo sem modelo (NFR-04).
- A recalibração do limiar (Fase 3) pode mudar o corte sem mexer em código: `VECTOR_MIN_SCORE`. Se a recalibração não separar as classes, basta `DIAGNOSIS_THRESHOLD_TRUSTED=false`.
- Os limites de 300 caracteres, K=5 e 10/min são arbitrários; reavaliar com uso real.
- Os limites em memória não protegem várias instâncias. Registrado como limitação.
- A camada opcional de LLM (ADR-008) entra sobre este resultado e não o altera.
