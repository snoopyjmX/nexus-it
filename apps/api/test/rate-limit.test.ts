import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/lib/rate-limit.js";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("rate limit em memória (T-04, ADR-009)", () => {
  it("libera até o máximo e depois bloqueia com o tempo que falta", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: time.now });
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfter("a")).toBeNull();
      limiter.record("a");
    }
    expect(limiter.retryAfter("a")).toBe(60);
    time.advance(45_000);
    expect(limiter.retryAfter("a")).toBe(15);
  });

  it("não conta tentativas que não foram registradas", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: clock().now });
    for (let i = 0; i < 10; i++) expect(limiter.retryAfter("a")).toBeNull();
  });

  it("zera ao fim da janela", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: time.now });
    limiter.record("a");
    expect(limiter.retryAfter("a")).not.toBeNull();
    time.advance(1000);
    expect(limiter.retryAfter("a")).toBeNull();
  });

  it("mantém chaves independentes", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: clock().now });
    limiter.record("a");
    expect(limiter.retryAfter("a")).not.toBeNull();
    expect(limiter.retryAfter("b")).toBeNull();
  });

  it("limita o número de chaves guardadas, descartando as mais antigas", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 3, now: time.now });
    for (const key of ["a", "b", "c", "d"]) {
      limiter.record(key);
      time.advance(1);
    }
    expect(limiter.size()).toBeLessThanOrEqual(3);
    expect(limiter.retryAfter("d")).not.toBeNull();
    expect(limiter.retryAfter("a")).toBeNull();
  });
});
