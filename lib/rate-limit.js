// 簡易レート制限（固定ウィンドウ）。
// サーバーレスではインスタンスごとのメモリなので厳密な全体制限ではないが、
// 連打や単純な自動化による API 消費を抑える一次防御として機能する。
export function createRateLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const hits = new Map();
  return function check(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (hits.size >= maxKeys) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      hits.set(key, { start: now, count: 1 });
      return { ok: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return { ok: false, retryAfter: Math.ceil((entry.start + windowMs - now) / 1000) };
    }
    return { ok: true, retryAfter: 0 };
  };
}
