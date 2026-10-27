// サイト全体（画面と /api/ocr）を Basic 認証で保護する。
// 環境変数 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD を Vercel に設定すること。
// 本番で未設定の場合は 503 を返し、APIキーが公開状態で使われることを防ぐ。
import { NextResponse } from "next/server";
import { checkBasicAuth } from "./lib/basic-auth.js";

export async function middleware(req) {
  const result = await checkBasicAuth({
    header: req.headers.get("authorization"),
    user: process.env.BASIC_AUTH_USER,
    pass: process.env.BASIC_AUTH_PASSWORD,
    isProduction: process.env.NODE_ENV === "production",
  });

  if (result === "ok") return NextResponse.next();

  if (result === "misconfigured") {
    return new NextResponse(
      "BASIC_AUTH_USER / BASIC_AUTH_PASSWORD が未設定のため、サービスを停止しています。",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  return new NextResponse("認証が必要です", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="meishi-scanner", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  // 静的アセット以外のすべてのパス（/api/ocr を含む）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
