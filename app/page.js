"use client";

import { useState, useEffect, useRef } from "react";

// ───────────────────────────────────────────────
// 名刺スキャナー Pro (Vercel/Gemini版)
// 撮影 → /api/ocr (Gemini) → 確認・編集 → localStorage保存 → CSV出力
// ───────────────────────────────────────────────

const FIELDS = [
  { key: "name", label: "氏名" },
  { key: "kana", label: "フリガナ" },
  { key: "company", label: "会社名" },
  { key: "department", label: "部署" },
  { key: "title", label: "役職" },
  { key: "zip", label: "郵便番号" },
  { key: "address", label: "住所" },
  { key: "tel", label: "電話番号" },
  { key: "mobile", label: "携帯番号" },
  { key: "fax", label: "FAX" },
  { key: "email", label: "メール" },
  { key: "url", label: "URL" },
  { key: "memo", label: "メモ" },
];

const STORAGE_KEY = "meishi-cards-v1";
const emptyCard = () => FIELDS.reduce((a, f) => ({ ...a, [f.key]: "" }), {});

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    r.readAsDataURL(file);
  });
}

// 画像を縮小しJPEG base64化(送信量を抑える)
async function prepareImage(file, maxDim = 1200) {
  const dataUrl = await readAsDataUrl(file);
  const draw = (src, w, h) => {
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    c.getContext("2d").drawImage(src, 0, 0, cw, ch);
    const out = c.toDataURL("image/jpeg", 0.82);
    const base64 = out.split(",")[1];
    if (!base64 || base64.length < 1000) return null;
    return { base64, mediaType: "image/jpeg" };
  };

  let result = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(img.naturalWidth ? draw(img, img.naturalWidth, img.naturalHeight) : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

  if (!result && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      result = draw(bmp, bmp.width, bmp.height);
      bmp.close?.();
    } catch {}
  }

  if (!result) {
    const ok = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (ok.includes(file.type)) {
      result = { base64: dataUrl.split(",")[1], mediaType: file.type };
    } else {
      throw new Error(
        `この画像形式(${file.type || "不明"})は処理できません。iPhoneは設定>カメラ>フォーマットを「互換性優先」にしてください`
      );
    }
  }
  return result;
}

async function ocrViaApi(base64, mediaType) {
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, mediaType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `サーバーエラー (HTTP ${res.status})`);
  const card = emptyCard();
  FIELDS.forEach((f) => {
    if (typeof data?.card?.[f.key] === "string") card[f.key] = data.card[f.key];
  });
  return card;
}

function buildCsv(cards) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = [...FIELDS.map((f) => f.label), "登録日時"].map(esc).join(",");
  const rows = cards.map((c) =>
    [...FIELDS.map((f) => c[f.key]), c.createdAt || ""].map(esc).join(",")
  );
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

export default function Page() {
  const [cards, setCards] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const fileRef = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCards(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  const persist = (next) => {
    setCards(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("保存失敗:", e);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    setScanning(true);
    try {
      const { base64, mediaType } = await prepareImage(file);
      let card;
      try {
        card = await ocrViaApi(base64, mediaType);
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        card = await ocrViaApi(base64, mediaType);
      }
      setDraft({ ...card, id: null });
    } catch (e) {
      setError(`読み取りに失敗しました。\n原因: ${e?.message || "不明"}`);
      console.error(e);
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  };

  const saveDraft = () => {
    if (!draft) return;
    if (draft.id) {
      persist(cards.map((c) => (c.id === draft.id ? { ...draft } : c)));
    } else {
      const n = new Date();
      const p = (x) => String(x).padStart(2, "0");
      const stamp = `${n.getFullYear()}/${p(n.getMonth() + 1)}/${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
      persist([{ ...draft, id: `card_${Date.now()}`, createdAt: stamp }, ...cards]);
    }
    setDraft(null);
    setEditingId(null);
  };

  const deleteCard = (id) => persist(cards.filter((c) => c.id !== id));

  const downloadCsv = () => {
    const blob = new Blob([buildCsv(cards)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    a.href = url;
    a.download = `meishi_db_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = cards.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return FIELDS.some((f) => (c[f.key] || "").toLowerCase().includes(q));
  });

  return (
    <div style={st.page}>
      <style>{css}</style>
      <header style={st.header}>
        <div style={st.headerInner}>
          <div>
            <div style={st.eyebrow}>BUSINESS CARD DATABASE</div>
            <h1 style={st.h1}>名刺スキャナー</h1>
          </div>
          <div style={st.counter}>
            <span style={st.counterNum}>{cards.length}</span>
            <span style={st.counterLabel}>件登録</span>
          </div>
        </div>
      </header>

      <main style={st.main}>
        <section style={st.scanSection}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" capture="environment"
            style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
          <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
          <button className="hanko-btn" onClick={() => fileRef.current?.click()} disabled={scanning} aria-label="撮影">
            {scanning ? <span className="spinner" aria-hidden="true" /> : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em" }}>
              {scanning ? "解析中" : "撮影"}
            </span>
          </button>
          <p style={st.scanHint}>名刺をカメラで撮影すると、AIが自動で項目を読み取ります</p>
          <button className="text-btn" onClick={() => galleryRef.current?.click()} disabled={scanning}>
            写真ライブラリから選択
          </button>
          {error && <div style={st.errorBox}>{error}</div>}
        </section>

        {draft && (
          <div style={st.overlay} role="dialog" aria-modal="true">
            <div style={st.modal}>
              <div style={st.modalHeader}>
                <span style={st.modalTitle}>{draft.id ? "名刺を編集" : "読取結果の確認"}</span>
                <span style={st.modalSub}>内容を確認し、必要に応じて修正してください</span>
              </div>
              <div style={st.modalBody}>
                {FIELDS.map((f) => (
                  <label key={f.key} style={st.fieldRow}>
                    <span style={st.fieldLabel}>{f.label}</span>
                    <input className="field-input" value={draft[f.key] || ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div style={st.modalFooter}>
                <button className="ghost-btn" onClick={() => setDraft(null)}>破棄</button>
                <button className="primary-btn" onClick={saveDraft}>
                  {draft.id ? "更新を保存" : "データベースに登録"}
                </button>
              </div>
            </div>
          </div>
        )}

        {cards.length > 0 && (
          <section style={st.toolbar}>
            <input className="field-input" style={{ flex: 1 }} placeholder="氏名・会社名などで検索"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="primary-btn" onClick={downloadCsv}>CSV出力</button>
          </section>
        )}

        <section style={st.list}>
          {loaded && cards.length === 0 && (
            <div style={st.empty}>
              <div style={st.emptyTitle}>まだ名刺が登録されていません</div>
              <div style={st.emptyText}>上のボタンから1枚目をスキャンしましょう</div>
            </div>
          )}
          {filtered.map((c) => (
            <article key={c.id} className="meishi-card">
              <div style={st.cardTop}>
                <div style={{ minWidth: 0 }}>
                  <div style={st.cardCompany}>{c.company || "（会社名なし）"}</div>
                  <div style={st.cardName}>
                    {c.name || "（氏名なし）"}
                    {c.kana && <span style={st.cardKana}>{c.kana}</span>}
                  </div>
                  {(c.department || c.title) && (
                    <div style={st.cardRole}>{[c.department, c.title].filter(Boolean).join(" / ")}</div>
                  )}
                </div>
                <div style={st.cardActions}>
                  <button className="icon-btn" onClick={() => setDraft({ ...c })}>編集</button>
                  {editingId === c.id ? (
                    <button className="icon-btn danger" onClick={() => { deleteCard(c.id); setEditingId(null); }}>削除確定</button>
                  ) : (
                    <button className="icon-btn" onClick={() => setEditingId(c.id)}>削除</button>
                  )}
                </div>
              </div>
              <div style={st.cardDetail}>
                {c.tel && <span>TEL {c.tel}</span>}
                {c.mobile && <span>携帯 {c.mobile}</span>}
                {c.email && <span>{c.email}</span>}
                {c.address && <span>{[c.zip, c.address].filter(Boolean).join(" ")}</span>}
              </div>
              {c.createdAt && <div style={st.cardDate}>登録: {c.createdAt}</div>}
            </article>
          ))}
        </section>
      </main>

      <footer style={st.footer}>
        データはこの端末のブラウザに保存されます ・ CSVはExcel対応(UTF-8 BOM付き)
      </footer>
    </div>
  );
}

const INDIGO = "#1F2A44";
const WASHI = "#F7F5F0";
const VERMILION = "#C8351F";
const INK = "#2B2B2B";

const st = {
  page: { minHeight: "100vh", background: WASHI, color: INK, fontFamily: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif" },
  header: { background: INDIGO, color: "#FFF" },
  headerInner: { maxWidth: 720, margin: "0 auto", padding: "20px 20px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" },
  eyebrow: { fontSize: 10, letterSpacing: "0.22em", opacity: 0.65, marginBottom: 4 },
  h1: { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.04em" },
  counter: { textAlign: "right", lineHeight: 1.1 },
  counterNum: { fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  counterLabel: { fontSize: 11, marginLeft: 4, opacity: 0.7 },
  main: { maxWidth: 720, margin: "0 auto", padding: "24px 16px 40px" },
  scanSection: { textAlign: "center", padding: "8px 0 20px" },
  scanHint: { fontSize: 13, color: "#666", margin: "14px 0 6px" },
  errorBox: { margin: "14px auto 0", maxWidth: 480, background: "#FBEAE7", border: `1px solid ${VERMILION}`, color: "#8C2516", borderRadius: 8, padding: "10px 14px", fontSize: 13, textAlign: "left", whiteSpace: "pre-wrap" },
  toolbar: { display: "flex", gap: 10, marginBottom: 18 },
  list: { display: "flex", flexDirection: "column", gap: 14 },
  empty: { textAlign: "center", padding: "44px 16px", border: "1px dashed #C9C4B8", borderRadius: 10 },
  emptyTitle: { fontWeight: 700, fontSize: 15, marginBottom: 6 },
  emptyText: { fontSize: 13, color: "#777" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  cardCompany: { fontSize: 12, color: "#6B6557", letterSpacing: "0.04em" },
  cardName: { fontSize: 18, fontWeight: 700, margin: "2px 0", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  cardKana: { fontSize: 11, color: "#888", fontWeight: 400 },
  cardRole: { fontSize: 12.5, color: "#555" },
  cardActions: { display: "flex", gap: 6, flexShrink: 0 },
  cardDetail: { marginTop: 10, paddingTop: 10, borderTop: "1px solid #EDE9DF", display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12.5, color: "#444" },
  cardDate: { marginTop: 8, fontSize: 10.5, color: "#A39E92" },
  overlay: { position: "fixed", inset: 0, background: "rgba(31,42,68,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  modal: { background: "#FFF", width: "100%", maxWidth: 560, maxHeight: "88vh", borderRadius: "16px 16px 0 0", display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHeader: { padding: "16px 20px 12px", borderBottom: "1px solid #EEE" },
  modalTitle: { fontWeight: 700, fontSize: 16, display: "block" },
  modalSub: { fontSize: 12, color: "#888" },
  modalBody: { padding: "12px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 },
  fieldRow: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 11.5, color: "#777", fontWeight: 600 },
  modalFooter: { padding: "12px 20px 18px", display: "flex", gap: 10, borderTop: "1px solid #EEE" },
  footer: { textAlign: "center", fontSize: 11, color: "#A39E92", padding: "0 16px 28px" },
};

const css = `
  * { box-sizing: border-box; }
  .hanko-btn { width: 96px; height: 96px; border-radius: 50%; background: ${VERMILION}; color: #FFF; border: none; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; box-shadow: 0 4px 14px rgba(200,53,31,0.35), inset 0 0 0 3px rgba(255,255,255,0.25); transition: transform 0.12s ease; }
  .hanko-btn:active { transform: scale(0.94); }
  .hanko-btn:disabled { opacity: 0.7; cursor: wait; }
  .spinner { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.35); border-top-color: #FFF; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .text-btn { background: none; border: none; color: ${INDIGO}; font-size: 13px; text-decoration: underline; cursor: pointer; padding: 6px; }
  .text-btn:disabled { opacity: 0.5; }
  .primary-btn { background: ${INDIGO}; color: #FFF; border: none; border-radius: 8px; padding: 11px 18px; font-size: 14px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
  .ghost-btn { background: none; border: 1px solid #CCC; border-radius: 8px; padding: 11px 18px; font-size: 14px; cursor: pointer; color: #555; }
  .field-input { border: 1px solid #D8D3C8; border-radius: 8px; padding: 10px 12px; font-size: 15px; width: 100%; background: #FFF; color: ${INK}; }
  .field-input:focus { outline: 2px solid ${INDIGO}; border-color: ${INDIGO}; }
  .meishi-card { background: #FFF; border-radius: 6px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(31,42,68,0.10), 0 4px 10px rgba(31,42,68,0.04); border-left: 3px solid ${VERMILION}; }
  .icon-btn { background: #F2F0EA; border: none; border-radius: 6px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; color: #555; white-space: nowrap; }
  .icon-btn.danger { background: ${VERMILION}; color: #FFF; }
`;
