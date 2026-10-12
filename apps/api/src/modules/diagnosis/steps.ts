// Marcador de lista numerada ("1." ou "1)") precedido por início de texto ou espaço e seguido de espaço.
const MARKER = /(?:^|\s)(\d{1,2})[.)]\s/g;
const BULLET = /^\s*[-*•]\s+/;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

// Só conta como numeração a sequência 1, 2, 3...: números soltos no meio do texto ("erro 5.") não quebram o passo.
// A lista precisa começar no início do texto; se houver preâmbulo, o texto inteiro cai no caso por linhas e nada se perde.
function splitNumbered(text: string): string[] | null {
  const markers: { at: number; from: number }[] = [];
  let expected = 1;
  for (const match of text.matchAll(MARKER)) {
    if (Number(match[1]) !== expected) continue;
    if (expected === 1 && match.index !== 0) return null;
    markers.push({ at: match.index, from: match.index + match[0].length });
    expected += 1;
  }
  if (markers.length === 0) return null;
  return markers.map((marker, i) => collapse(text.slice(marker.from, markers[i + 1]?.at ?? text.length))).filter(Boolean);
}

// Próximos testes do diagnóstico (FR-09): o texto do passo é o do procedimento aprovado, sem reescrever.
export function extractSteps(procedure: string): string[] {
  const text = procedure.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  return splitNumbered(text) ?? text.split("\n").map((line) => collapse(line.replace(BULLET, ""))).filter(Boolean);
}
