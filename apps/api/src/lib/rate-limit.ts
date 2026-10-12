interface Options {
  max: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

interface Entry {
  count: number;
  resetAt: number;
}

// Janela fixa em memória (ADR-009). `retryAfter` consulta sem contar; quem usa
// decide o que registrar (ex.: só falhas de login). O estado some se o processo
// reiniciar e não vale entre instâncias.
export function createRateLimiter({ max, windowMs, maxKeys = 10_000, now = Date.now }: Options) {
  const entries = new Map<string, Entry>();

  function live(key: string): Entry | undefined {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    // Segundos até poder tentar de novo, ou null se ainda pode.
    retryAfter(key: string): number | null {
      const entry = live(key);
      if (!entry || entry.count < max) return null;
      return Math.max(1, Math.ceil((entry.resetAt - now()) / 1000));
    },

    record(key: string): void {
      const entry = live(key);
      if (entry) {
        entry.count += 1;
        return;
      }
      // A ordem de inserção do Map é a ordem de chegada: descarta a mais antiga.
      if (entries.size >= maxKeys) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(key, { count: 1, resetAt: now() + windowMs });
    },

    size: () => entries.size,
  };
}
