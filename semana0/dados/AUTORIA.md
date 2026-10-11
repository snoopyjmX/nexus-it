# Autoria dos dados da Semana 0

Exigido por [criterios.md](criterios.md). Atualizado no mesmo commit de cada parte.

| Parte | Escrita por | Revisada por | Observação |
| --- | --- | --- | --- |
| Títulos, consultas e gold | IA (Claude), a pedido do autor do projeto | pendente (autor) | Escritos e commitados antes do corpus |
| Corpus: 30 artigos e 10 chamados (`corpus.json`) | IA (Claude), a pedido do autor do projeto | pendente (autor) | Todos com `rascunho_llm: true`. Escrito depois das consultas e do gold. Revisão com rigor de N2 prevista no protocolo ainda não feita |
| Casos de geração (`casos-geracao.json`) | IA (Claude) | pendente (autor) | 8 respondíveis, 2 sem resposta, 2 injection; documentos plantados `kb-ac-02` e `ch-08` |
| Leitura de injection (critérios b e c) | a definir | | Se for a mesma IA, declarar nos resultados |

## Desvios do protocolo conhecidos

- `kb-im-04` e `kb-es-02` têm menos de 100 palavras (o protocolo pede 100–200). Média dos artigos: 115 palavras. Não foram ajustados para não mexer no corpus em função de resultados.
- Os chamados têm de 53 a 99 palavras; o protocolo não fixa tamanho para eles.
- O corpus não foi lido contra nenhum resultado de busca antes do commit. Nenhuma consulta foi rodada.
- A mesma IA escreveu consultas e corpus. As consultas foram commitadas primeiro (958395a), mas o vocabulário pode coincidir mais do que numa autoria separada.
