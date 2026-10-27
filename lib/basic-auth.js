// Basic認証の判定ロジック（middleware から利用。Edge Runtime で動くよう Web 標準 API のみ使用）

// 長さや一致位置で処理時間が変わらないよう、全文字を比較する。
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function parseBasicAuth(header) {
  if (!header || !/^Basic\s+/i.test(header)) return null;
  try {
    const decoded = atob(header.replace(/^Basic\s+/i, "").trim());
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

// 戻り値: "ok" | "unauthorized" | "misconfigured"
// 本番で認証情報が未設定のときは、公開状態で動かさないよう "misconfigured"（拒否）にする。
export function checkBasicAuth({ header, user, pass, isProduction }) {
  if (!user || !pass) return isProduction ? "misconfigured" : "ok";
  const creds = parseBasicAuth(header);
  if (!creds) return "unauthorized";
  const userOk = safeEqual(creds.user, user);
  const passOk = safeEqual(creds.pass, pass);
  return userOk && passOk ? "ok" : "unauthorized";
}
