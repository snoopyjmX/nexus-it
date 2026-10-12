# Case: o experimento de viabilidade antes de construir o produto (Semana 0)

Texto para o portfólio, escrito a partir de `semana0/dados/decisao.md` e dos arquivos em `semana0/resultados/`. Todo número abaixo está nesses arquivos. Os dados são sintéticos.

## A pergunta
O NEXUS IT é uma ferramenta fictícia de suporte de TI: o técnico abre um chamado e vê artigos da base de conhecimento, passos de verificação e, quando a evidência é fraca, uma abstenção explícita. Antes de escrever o produto, três decisões dependiam de dados:

1. A busca vetorial acerta paráfrases que a busca por palavras (full-text) erra?
2. Existe um limiar de similaridade que separa "tem resposta na base" de "não tem"?
3. Um modelo local pequeno consegue redigir a explicação com fontes corretas, sem obedecer instruções plantadas nos documentos (injection), dentro de um tempo aceitável num notebook?

## Como foi feito
- Os critérios de aprovação foram escritos e commitados **antes** de qualquer medição (`criterios.md`) e não foram alterados depois.
- Corpus de 30 artigos e 10 chamados resolvidos; 30 consultas (diretas, paráfrases leigas, ambíguas e sem resposta); gold escrito antes do corpus.
- Embedding `bge-m3` (1024 dimensões) com pgvector, busca exata por cosseno. Geração com `qwen3.5:4b` e `gemma3:4b` via Ollama, temperatura zero, num MacBook Pro 2019 Intel de 16 GB.
- Resultado guardado como JSON bruto, com versão dos dados.

## O que deu
| Pergunta | Resultado | Critério |
| --- | --- | --- |
| Busca | Vetorial acerta 10 de 10 paráfrases; a lexical padrão, 0 de 10. Nas diretas, 8/8 contra 5/8 | Passa |
| Limiar | 0,5393. Validação: abstém 3 de 4 sem-resposta e perde 0 de 9 respondíveis | Passa, com margem fina |
| Geração | `gemma3:4b` cumpre todos os critérios (p50 18,4 s, 8/8 fontes, 0 ataques). `qwen3.5:4b` falha só no tempo (p50 25,0 s) | Passa com um dos dois modelos |
| Injection | Em 2 casos, nenhum dos dois modelos obedeceu a instrução plantada | Sem ataque bem-sucedido |

## O que eu corrigi no meio do caminho
- Uma primeira leitura concluiu "a geração não passou", porque faltava um dado: se o notebook continuou responsivo durante os testes. Com esse dado, a regra pré-registrada dava "passa". Mantive a regra, não a preferência, e registrei a mudança de conclusão.
- Um número do resumo estava errado (22 consultas com resposta, não 30). Corrigido no arquivo.

## O que o resultado não prova
- São 30 consultas e critérios heurísticos. Uma diferença de 1 ou 2 casos é ruído.
- O corpus é pequeno e discrimina bem demais: a vetorial acerta o 1º lugar em todas as 22 consultas com resposta. Uma base maior tende a ser mais difícil.
- O lexical da Semana 0 usava `websearch_to_tsquery`, que exige todos os termos, e por isso zerou nas paráfrases. Não medi a vetorial contra um lexical afinado (OU entre termos, outros pesos). No produto, a busca lexical passou a usar OU, e essa comparação ficou para a avaliação da Fase 3.
- A margem do limiar é de 0,015: o menor score de uma consulta respondível foi 0,5542 e o maior de uma sem-resposta, 0,5603. O limiar foi ajustado com 4 consultas sem resposta e precisa ser recalibrado na base real.
- A injection foi testada em 2 casos, com uma redação de ataque cada. Mostra que esses dois modelos não obedeceram essas duas instruções, não que sejam robustos.
- Consultas, corpus e casos foram escritos por IA (Claude) a pedido do autor e revisados por ele; a revisão está registrada em `semana0/dados/AUTORIA.md`. Isso favorece resultados otimistas, e o resultado é tratado como exploratório.

## O que mudou no produto por causa disso
- Busca vetorial com `bge-m3` (ADR-007), com a lexical mantida como baseline e como fallback quando o Ollama está fora do ar.
- Abstenção por limiar sobre o score vetorial, recalibrado na base real.
- Diagnóstico determinístico primeiro (ADR-002); o LLM, se ligado, só redige a explicação a partir de passos já validados (ADR-008, opção B), e o prompt dessa opção será medido de novo na Fase 4 antes de virar padrão.
