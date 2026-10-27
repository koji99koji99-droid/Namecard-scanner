import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBasicAuth, parseBasicAuth, safeEqual } from "../lib/basic-auth.js";
import { createRateLimiter } from "../lib/rate-limit.js";

const header = (u, p) => "Basic " + btoa(`${u}:${p}`);

test("正しい認証情報なら通す", async () => {
  assert.equal(await checkBasicAuth({ header: header("a", "b:c"), user: "a", pass: "b:c", isProduction: true }), "ok");
});
test("誤った認証情報・ヘッダーなしは拒否", async () => {
  assert.equal(await checkBasicAuth({ header: header("a", "x"), user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(await checkBasicAuth({ header: null, user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(await checkBasicAuth({ header: "Basic !!!", user: "a", pass: "b", isProduction: true }), "unauthorized");
  assert.equal(await checkBasicAuth({ header: "Bearer xyz", user: "a", pass: "b", isProduction: true }), "unauthorized");
});
test("本番で未設定なら停止、開発では素通し", async () => {
  assert.equal(await checkBasicAuth({ header: null, user: "", pass: "", isProduction: true }), "misconfigured");
  assert.equal(await checkBasicAuth({ header: null, user: "a", pass: "", isProduction: true }), "misconfigured");
  assert.equal(await checkBasicAuth({ header: null, user: "", pass: "", isProduction: false }), "ok");
});
test("safeEqual は長さ違い・前方一致を一致としない", async () => {
  assert.equal(await safeEqual("abc", "abc"), true);
  assert.equal(await safeEqual("abc", "abcd"), false);
  assert.equal(await safeEqual("", "a"), false);
});
test("パスワード中のコロンを保持", () => {
  assert.deepEqual(parseBasicAuth(header("u", "p:q")), { user: "u", pass: "p:q" });
});
test("UTF-8 のパスワードを受け付ける", async () => {
  const binary = String.fromCharCode(...new TextEncoder().encode("u:秘密"));
  const utf8Header = "Basic " + btoa(binary);
  assert.deepEqual(parseBasicAuth(utf8Header), { user: "u", pass: "秘密" });
  assert.equal(await checkBasicAuth({ header: utf8Header, user: "u", pass: "秘密", isProduction: true }), "ok");
});
test("不正な UTF-8 は拒否", async () => {
  const invalidHeader = "Basic " + btoa(String.fromCharCode(0x75, 0x3a, 0xff));
  assert.equal(parseBasicAuth(invalidHeader), null);
  assert.equal(await checkBasicAuth({ header: invalidHeader, user: "u", pass: "秘密", isProduction: true }), "unauthorized");
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
