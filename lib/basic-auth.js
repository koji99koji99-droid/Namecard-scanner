// Basic認証の判定ロジック（middleware から利用。Edge Runtime で動くよう Web 標準 API のみ使用）

// SHA-256 の固定長ダイジェストを比較し、入力の長さで比較回数を変えない。
export async function safeEqual(a, b) {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(a))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(b))),
  ]);
  const xBytes = new Uint8Array(x);
  const yBytes = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= xBytes[i] ^ yBytes[i];
  }
  return diff === 0;
}

export function parseBasicAuth(header) {
  if (!header || !/^Basic\s+/i.test(header)) return null;
  try {
    const binary = atob(header.replace(/^Basic\s+/i, "").trim());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

// 戻り値: "ok" | "unauthorized" | "misconfigured"
// 本番で認証情報が未設定のときは、公開状態で動かさないよう "misconfigured"（拒否）にする。
export async function checkBasicAuth({ header, user, pass, isProduction }) {
  if (!user || !pass) return isProduction ? "misconfigured" : "ok";
  const creds = parseBasicAuth(header);
  if (!creds) return "unauthorized";
  const [userOk, passOk] = await Promise.all([
    safeEqual(creds.user, user),
    safeEqual(creds.pass, pass),
  ]);
  return userOk && passOk ? "ok" : "unauthorized";
}
