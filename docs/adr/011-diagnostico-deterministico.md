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
3. **Abstenção:** o limiar só é aplicado quando `DIAGNOSIS_THRESHOLD_TRUSTED=true`, e o padrão é `false`: o ADR-007 diz que sem recalibração na base real o limiar não é confiável (as classes se sobrepõem entre 0,554 e 0,560), e a recalibração ainda depende do conjunto de teste da Fase 3. Com busca vetorial e limiar confiável, só entram fontes com score a partir do limiar; sem nenhuma, o painel abstém ("evidência insuficiente"). Com busca por palavras (embeddings desligados ou Ollama fora do ar) ou com o limiar não confiável, não há corte: as fontes saem rotuladas "evidência não verificada"; sem nenhuma, também abstém. É o fallback do PRD (FR-10) e do `criterios.md`. Quem decide virar a chave para `true` é o autor, depois de registrar a recalibração.
4. **Sem score na resposta.** Nem porcentagem nem valor bruto: score não é probabilidade e o ranking já diz a ordem.
5. **Passos:** só do campo `procedure` dos artigos publicados entre as fontes (até os 3 primeiros), extraídos por regra, sem reescrever. Chamados resolvidos aparecem como fontes, sem passos. O texto é sempre exibido como texto puro.
6. **Limites (T-04):** 10 diagnósticos por minuto por usuário e 1 em andamento por usuário, em memória (mesma ressalva do ADR-009: vale por processo). O 11º pedido e o pedido concorrente recebem 429.
7. **Registro (`ai_runs`):** quem pediu, qual chamado, modo da busca, ids recuperados, abstenção, evidência, duração e o feedback. Nunca o texto do chamado, das fontes ou dos passos. O feedback guarda quem avaliou (qualquer técnico pode avaliar; a última avaliação substitui a anterior). A correção é texto livre do técnico, de até 1000 caracteres, e não altera artigo nem chamado.
8. **Resumo opcional por modelo (ADR-008, opção B):** só roda com `LLM_ENABLED=true`, depois do resultado determinístico e nunca em abstenção. O prompt (versão `resumo-v1`) leva o chamado, as fontes e os passos já escolhidos, com rótulos F1..Fn no lugar de ids, dentro de um bloco de dados cujos delimitadores são removidos do texto. A resposta tem de ser JSON estrito `{resumo, fontes}`; o servidor descarta (e conta) rótulos que não existem, aceita no máximo 1500 caracteres de texto sem caracteres de controle e **descarta o resumo inteiro se nenhuma citação for válida** (resumo sem fonte não é mostrado). Falha, JSON inválido ou resumo sem citação não afetam o resto: a resposta traz `llm: "unavailable"` e o painel avisa (FR-13). O texto do resumo não é gravado: `ai_runs` guarda só modelo, versão do prompt, desfecho e quantas citações foram descartadas. O front mostra o resumo como texto puro, rotulado como gerado por IA.

## Consequências
- O painel funciona sem LLM e sem Ollama. A CI testa tudo sem modelo (NFR-04).
- Enquanto a recalibração não for registrada, o painel nunca afirma suficiência e, em busca vetorial, mostra as fontes mais próximas sem corte, todas "não verificadas". A recalibração (Fase 3) ajusta `VECTOR_MIN_SCORE`; se separar as classes, o autor liga `DIAGNOSIS_THRESHOLD_TRUSTED=true`; se não separar, o padrão já é o fallback do PRD.
- Os limites de 300 caracteres, K=5 e 10/min são arbitrários; reavaliar com uso real.
- Os limites em memória não protegem várias instâncias. Registrado como limitação.
- A camada opcional de LLM (ADR-008) entra sobre este resultado e não o altera. Ainda não foi medida com este prompt; o ADR-008 exige a re-medição (p50 de até 20 s) antes de ligar por padrão, e ela depende do Ollama do autor. Os casos de injeção da suíte usam um modelo falso; resistência real do `gemma3:4b` com o prompt B não está comprovada.
