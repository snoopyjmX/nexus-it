# 007. Busca vetorial com bge-m3 e pgvector (busca exata)

Data: 2026-10-11 · Status: aceito

## Contexto
O PRD (FR-08) só admite busca vetorial se ela passar no gate da Semana 0. Passou: nas 10 paráfrases a vetorial acertou 10/10 no top-5 e a lexical 0/10, sem perder nenhuma direta (`semana0/dados/decisao.md`). A abstenção por limiar também passou, com margem fina.

Limites da evidência: o lexical medido usa `websearch_to_tsquery` (exige todos os termos), então o ganho sobre um lexical afinado não foi medido. O corpus tem 40 documentos escritos por IA, e a vetorial acertou o 1º lugar em todas as 22 consultas com resposta, o que indica um corpus fácil. Os números são exploratórios.

## Opções consideradas
- Manter só full-text: sem dependência nova / falha em paráfrase leiga, que é o caso de uso principal.
- Vetorial com `bge-m3`: acerta paráfrases, score de cosseno usável como limiar / depende do Ollama para vetorizar documentos e consultas.
- Híbrida (RRF, k=60): empatou com a vetorial em Hit@5 e MRR / o score RRF mede posição, não semelhança, e não serve de limiar (0/4 de abstenção na calibração).

## Decisão
Busca vetorial com `bge-m3` via Ollama (1024 dimensões) e pgvector, 1 documento = 1 vetor na própria linha (ADR-001), busca exata por distância de cosseno, sem índice ANN. O score do 1º resultado é a similaridade de cosseno (`1 - distância`) e alimenta o limiar de abstenção (ADR-002). O limiar medido, 0,5393, é só o ponto de partida: fica em configuração, não no código, e é recalibrado com a base real. A busca lexical continua existindo como baseline e como fallback (FR-07). A híbrida fica descartada por ora.

## Consequências
- Migração futura: `CREATE EXTENSION vector` e coluna `embedding vector(1024)` em `kb_articles` e `tickets`, com `embedding_model` (já previsto em ARCHITECTURE §2). A imagem `pgvector/pgvector:pg17` já está no Compose. O código entra na Fase 3; esta decisão não escreve migração.
- Dimensão fixa. Trocar de modelo de embedding exige recalcular todos os vetores e um ADR novo.
- Sem índice ANN. Reavaliar com ADR se a base passar de alguns milhares de linhas ou a busca ficar lenta.
- A margem do limiar é fina: o menor score de uma consulta respondível foi 0,5542 e o maior de uma sem-resposta foi 0,5603, ambas as faixas se sobrepondo. Sem recalibração na base real, o limiar não é confiável. Se continuar sem separar, vale o ADR-002: fontes rotuladas "evidência não verificada", sem porcentagem.
- A consulta vetorial filtra status e escopo do papel na própria query (T-06, T-15, FR-15).

## Em aberto (precisa de decisão antes da Fase 3)
Vetorizar depende do Ollama, que pode estar fora do ar (FR-13, T-12). O ADR-001 diz que o embedding é recalculado na transação que publica o artigo, e uma chamada HTTP lenta dentro de uma transação segura conexão do banco e falha junto com o modelo. Proposta, que muda a letra do ADR-001 e por isso não está aceita aqui:

1. Calcular o embedding antes de abrir a transação.
2. Se o Ollama estiver indisponível, publicar mesmo assim com `embedding` nulo. A busca vetorial ignora linhas sem vetor, e um comando de backfill recalcula depois.
3. Se não for possível vetorizar a consulta, a busca cai para a lexical e a interface avisa.

Despublicar continua excluindo da busca por construção, porque o filtro de status está na mesma linha.
