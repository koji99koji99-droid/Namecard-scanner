# 名刺スキャナー（Vercel / Gemini 版）

スマホのカメラで名刺を撮影 → Gemini API が自動で項目を抽出 → 確認・修正 → ブラウザに保存 → CSV 出力。

**設計の要点**：Gemini API キーはサーバーレス関数（`/api/ocr`）の中だけで使われ、ブラウザには一切送られません。これがアーティファクト版との決定的な違いで、本番運用に耐える構成です。

---

## デプロイ手順（所要 15〜20 分・無料）

### ステップ 1：Gemini API キーを取得

1. https://aistudio.google.com/apikey にアクセス（Google アカウントでログイン）
2. 「Create API key」でキーを発行し、コピーしておく

無料枠（Flash-Lite で 1 日あたり相当数のリクエスト）があるため、個人〜小規模利用なら課金なしで始められます。

### ステップ 2：GitHub にコードを置く

1. GitHub で空のリポジトリを新規作成（例：`meishi-scanner`）
2. このフォルダ一式（`app/`、`package.json`、`.env.example` など）をそのリポジトリにアップロード
   - GitHub の「Add file → Upload files」でフォルダごとドラッグ＆ドロップでも可

### ステップ 3：Vercel にデプロイ

1. https://vercel.com にアクセスし、GitHub アカウントで登録・ログイン
2. 「Add New → Project」→ ステップ 2 のリポジトリを「Import」
3. **環境変数を設定**（ここが最重要）
   - Settings → Environment Variables で以下を追加：
     - `GEMINI_API_KEY` ＝ ステップ 1 のキー
     - `GEMINI_MODEL` ＝ `gemini-2.5-flash-lite`（任意）
4. 「Deploy」を押す → 1〜2 分で `https://〇〇.vercel.app` が発行される

### ステップ 4：スマホで使う

1. 発行された URL を iPhone の Safari で開く
2. Safari 共有ボタン →「ホーム画面に追加」でアプリのように使える（PWA 化）
3. 撮影ボタンから名刺を読み取り

---

## ローカルで試す場合（任意）

```bash
npm install
cp .env.example .env.local   # .env.local に APIキーを記入
npm run dev                  # http://localhost:3000
```

---

## モデルとコストの目安

| モデル | 用途 | 特徴 |
|---|---|---|
| `gemini-2.5-flash-lite` | 既定・コスト最優先 | 名刺 OCR には十分な精度。無料枠あり |
| `gemini-2.5-flash` | 精度優先 | 小さい文字・複雑なレイアウトに強い |

モデルは環境変数 `GEMINI_MODEL` を変えるだけで切り替わります（コード修正不要）。

---

## 本格運用に向けた拡張ポイント

現状はデータを「その端末のブラウザ（localStorage）」に保存します。個人利用なら十分ですが、複数人・複数端末で共有する段階になったら次の拡張を検討してください。

- **データの共有保存**：Supabase（無料枠）や Vercel KV に置き換えると、端末をまたいでデータを同期できる
- **アクセス制限**：社内利用なら Vercel の認証機能や Basic 認証で URL を保護
- **個人情報保護**：名刺は個人データに該当するため、保存先・アクセス権限・退職時のデータ削除フローを運用ルールとして整備

全社規模に広げる場合は、これらを自前で作り込むより既存の名刺管理 SaaS（Sansan、Eight Team 等）の方が総コストで有利になることが多い点も判断材料に。まずは本アプリで小さく実証し、ニーズが固まってから経営判断する流れが堅実です。
