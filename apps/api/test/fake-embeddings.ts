import type { EmbeddingProvider } from "../src/modules/embeddings/provider.js";

const DIMENSIONS = 1024;

function hash(word: string): number {
  let h = 2166136261;
  for (const char of word) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return Math.abs(h) % DIMENSIONS;
}

// Saco de palavras em 1024 dimensões: textos com palavras em comum têm cosseno alto.
// Basta para testar o encanamento sem Ollama (NFR-04). Não mede qualidade de busca.
export function vectorFor(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  for (const word of words) vector[hash(word)] = (vector[hash(word)] ?? 0) + 1;
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

export interface FakeProvider extends EmbeddingProvider {
  down: boolean;
  calls: string[][];
}

export function createFakeProvider(model = "fake-bge-m3"): FakeProvider {
  const provider: FakeProvider = {
    model,
    down: false,
    calls: [],
    async embed(texts) {
      provider.calls.push(texts);
      if (provider.down) throw new Error("Ollama fora do ar");
      return texts.map(vectorFor);
    },
  };
  return provider;
}
