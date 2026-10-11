# 001. Embedding na própria linha, sem tabela de chunks

Data: 2026-10-10 · Status: aceito

## Contexto
O plano original previa uma tabela `chunks` com embeddings de artigos e chamados. Os artigos são curtos e estruturados (100–200 palavras), e uma tabela separada exigiria sincronizar o índice a cada edição, publicação e exclusão. Uma falha de sincronização vaza rascunhos e artigos despublicados pela busca.

## Opções consideradas
- Tabela `chunks` separada: permite dividir documentos longos / exige rotina de consistência e testes próprios; risco de vazamento.
- Coluna `embedding` em `kb_articles` e `tickets`: 1 documento = 1 vetor; filtro de status na mesma linha / não serve para documentos longos.

## Decisão
Coluna `embedding` na própria linha, recalculada na transação que publica o artigo ou resolve o chamado; a busca filtra o status na mesma query.

## Consequências
Despublicar exclui da busca por construção, sem rotina extra. Se surgirem fontes longas que precisem ser divididas, reavaliar com novo ADR.
