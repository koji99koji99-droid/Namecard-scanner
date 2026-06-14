// 名刺OCR用サーバーレス関数
// 画像を受け取り Gemini API で構造化抽出して返す。
// APIキーはサーバー側の環境変数でのみ参照され、ブラウザには一切露出しない。

export const runtime = "nodejs";
export const maxDuration = 30;

// 使用モデルは環境変数で差し替え可能。既定はコスト効率の高い Flash-Lite。
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const PROMPT = `この画像は日本の名刺です。記載情報を読み取り、以下のキーを持つJSONオブジェクトのみを返してください。説明文やMarkdownのコードブロックは一切不要です。読み取れない項目は空文字列にしてください。

{
  "name": "氏名",
  "kana": "氏名のフリガナ(カタカナ。記載がなければ推定可)",
  "company": "会社名・組織名",
  "department": "部署名",
  "title": "役職",
  "zip": "郵便番号(例: 630-0000)",
  "address": "住所",
  "tel": "電話番号",
  "mobile": "携帯番号",
  "fax": "FAX番号",
  "email": "メールアドレス",
  "url": "WebサイトURL",
  "memo": "その他の特記事項(資格・認定・キャッチコピー等)"
}`;

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: "サーバーにGEMINI_API_KEYが設定されていません" }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "リクエストの解析に失敗しました" }, 400);
  }

  const { imageBase64, mediaType } = body || {};
  if (!imageBase64) {
    return json({ error: "画像データが含まれていません" }, 400);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const geminiBody = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          {
            inline_data: {
              mime_type: mediaType || "image/jpeg",
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
  } catch (e) {
    return json({ error: `Gemini APIへの接続に失敗: ${e.message}` }, 502);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || "";
    } catch {}
    return json({ error: `Gemini APIエラー (HTTP ${res.status}) ${detail}`.trim() }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return json({ error: "Gemini応答の解析に失敗しました" }, 502);
  }

  // 応答テキストを取り出す
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("") || "";

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return json({ error: "名刺の文字を認識できませんでした。鮮明な画像で再度お試しください" }, 422);
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return json({ error: "読取結果のデータ変換に失敗しました" }, 422);
  }

  return json({ card: parsed }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
