import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBasicAuth, parseBasicAuth, safeEqual } from "../lib/basic-auth.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const header = (u, p) => "Basic " + btoa(`${u}:${p}`);

test("正しい認証情報なら通す", () => {
  assert.equal(checkBasicAuth({ header: header("a", "b:c"), user: "a", pass: "b:c", isProduction: true }), "ok");
});
test("誤った認証情報・ヘッダーなしは拒否", () => {
  assert.equal(checkBasicAuth({ header: header("a", "x"), user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(checkBasicAuth({ header: null, user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(checkBasicAuth({ header: "Basic !!!", user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(checkBasicAuth({ header: "Bearer xyz", user: "a", pass: "b", isProduction: true }), "unauthorized");
});
test("本番で未設定なら停止、開発では素通し", () => {
  assert.equal(checkBasicAuth({ header: null, user: "", pass: "", isProduction: true }), "misconfigured");
  assert.equal(checkBasicAuth({ header: null, user: "a", pass: "", isProduction: true }), "misconfigured");
  assert.equal(checkBasicAuth({ header: null, user: "", pass: "", isProduction: false }), "ok");
});
test("safeEqual は長さ違い・前方一致を一致としない", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", "a"), false);
});
test("パスワード中のコロンを保持", () => {
  assert.deepEqual(parseBasicAuth(header("u", "p:q")), { user: "u", pass: "p:q" });
});
test("レート制限は上限超過で拒否し、時間経過で回復", () => {
  const check = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(check("ip", 0).ok, true);
  assert.equal(check("ip", 10).ok, true);
  const third = check("ip", 20);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfter, 1);
  assert.equal(check("other", 20).ok, true);
  assert.equal(check("ip", 1000).ok, true);
});
