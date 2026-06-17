"use client";

import { useState, useEffect, useRef } from "react";

// ───────────────────────────────────────────────
// 名刺スキャナー Pro (Vercel/Gemini版) — フェーズ1: 最大4枚同時スキャン対応
// ───────────────────────────────────────────────

const FIELDS = [
  { key: "name",       label: "氏名" },
  { key: "kana",       label: "フリガナ" },
  { key: "company",    label: "会社名" },
  { key: "department", label: "部署" },
  { key: "title",      label: "役職" },
  { key: "zip",        label: "郵便番号" },
  { key: "address",    label: "住所" },
  { key: "tel",        label: "電話番号" },
  { key: "mobile",     label: "携帯番号" },
  { key: "fax",        label: "FAX" },
  { key: "email",      label: "メール" },
  { key: "url",        label: "URL" },
  { key: "memo",       label: "メモ" },
];

const STORAGE_KEY = "meishi-cards-v1";
const MAX_CARDS = 4;
const emptyCard = () => FIELDS.reduce((a, f) => ({ ...a, [f.key]: "" }), {});

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    r.readAsDataURL(file);
  });
}

async function prepareImage(file, maxDim = 1200) {
  const dataUrl = await readAsDataUrl(file);
  const draw = (src, w, h) => {
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(src, 0, 0, cw, ch);
    const out = c.toDataURL("image/jpeg", 0.82);
    const base64 = out.split(",")[1];
    if (!base64 || base64.length < 1000) return null;
    return { base64, mediaType: "image/jpeg" };
  };
  let result = await new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img.naturalWidth ? draw(img, img.naturalWidth, img.naturalHeight) : null);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
  if (!result && typeof createImageBitmap === "function") {
    try { const bmp = await createImageBitmap(file); result = draw(bmp, bmp.width, bmp.height); bmp.close?.(); } catch {}
  }
  if (!result) {
    const ok = ["image/jpeg","image/png","image/gif","image/webp"];
    if (ok.includes(file.type)) result = { base64: dataUrl.split(",")[1], mediaType: file.type };
    else throw new Error(`この画像形式(${file.type||"不明"})は処理できません`);
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
  FIELDS.forEach((f) => { if (typeof data?.card?.[f.key] === "string") card[f.key] = data.card[f.key]; });
  return card;
}

function buildCsv(cards) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = [...FIELDS.map((f) => f.label), "登録日時"].map(esc).join(",");
  const rows = cards.map((c) => [...FIELDS.map((f) => c[f.key]), c.createdAt || ""].map(esc).join(","));
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

async function exportCsv(cards) {
  const content  = buildCsv(cards);
  const d = new Date(); const p = (x) => String(x).padStart(2,"0");
  const filename = `meishi_db_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}.csv`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const file = new File([blob], filename, { type: "text/csv;charset=utf-8" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "名刺データベース" }); return; } catch {}
  }
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function nowStamp() {
  const n = new Date(); const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}/${p(n.getMonth()+1)}/${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
}

// ─── メインコンポーネント ───────────────────────────────
export default function Page() {
  const [cards,          setCards]          = useState([]);
  const [loaded,         setLoaded]         = useState(false);
  const [scanning,       setScanning]       = useState(false);
  const [globalError,    setGlobalError]    = useState("");
  const [drafts,         setDrafts]         = useState([]); // [{id, card, status, error}]
  const [expandedIdx,    setExpandedIdx]    = useState(null);
  const [editingCardId,  setEditingCardId]  = useState(null);
  const [query,          setQuery]          = useState("");
  const fileRef    = useRef(null);
  const galleryRef = useRef(null);

  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setCards(JSON.parse(raw)); } catch {}
    setLoaded(true);
  }, []);

  const persist = (next) => {
    setCards(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
  };

  // ── 複数ファイル処理 ──────────────────────────────────
  const handleFiles = async (files) => {
    const fileArr = Array.from(files).slice(0, MAX_CARDS);
    if (!fileArr.length) return;
    setGlobalError("");
    setScanning(true);

    // 初期状態: processing
    const initial = fileArr.map((_, i) => ({
      id: `draft_${Date.now()}_${i}`,
      card: emptyCard(),
      status: "processing",
      error: "",
    }));
    setDrafts(initial);
    setExpandedIdx(null);

    // 全枚並列処理
    const results = await Promise.allSettled(
      fileArr.map(async (file) => {
        const { base64, mediaType } = await prepareImage(file);
        try { return await ocrViaApi(base64, mediaType); }
        catch {
          await new Promise((r) => setTimeout(r, 1200));
          return ocrViaApi(base64, mediaType);
        }
      })
    );

    const next = results.map((r, i) => ({
      id: initial[i].id,
      card:   r.status === "fulfilled" ? r.value : emptyCard(),
      status: r.status === "fulfilled" ? "done" : "error",
      error:  r.status === "rejected"  ? (r.reason?.message || "読み取り失敗") : "",
    }));
    setDrafts(next);
    setExpandedIdx(0);
    setScanning(false);
    if (fileRef.current)    fileRef.current.value    = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  // ── ドラフト操作 ──────────────────────────────────────
  const updateDraftField = (id, key, value) =>
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, card: { ...d.card, [key]: value } } : d));

  const removeDraft = (id) => setDrafts((prev) => prev.filter((d) => d.id !== id));

  const saveAllDrafts = () => {
    const ok = drafts.filter((d) => d.status === "done");
    if (!ok.length) return;
    const stamp = nowStamp();
    const newCards = ok.map((d) => ({
      ...d.card,
      id: `card_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: stamp,
    }));
    persist([...newCards, ...cards]);
    setDrafts([]);
    setExpandedIdx(null);
  };

  // ── 既存カード操作 ────────────────────────────────────
  const saveEdit = (edited) => {
    persist(cards.map((c) => c.id === edited.id ? edited : c));
    setEditingCardId(null);
  };
  const deleteCard = (id) => persist(cards.filter((c) => c.id !== id));


  const filtered = cards.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return FIELDS.some((f) => (c[f.key] || "").toLowerCase().includes(q));
  });

  const okDrafts    = drafts.filter((d) => d.status === "done");
  const errorDrafts = drafts.filter((d) => d.status === "error");

  // ── レンダリング ──────────────────────────────────────
  return (
    <div style={st.page}>
      <style>{css}</style>

      {/* ヘッダー */}
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

        {/* スキャンエリア */}
        <section style={st.scanSection}>
          {/* 隠しinput(カメラ) — iOS は multiple 非対応のため1枚ずつ */}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png"
            capture="environment" style={{ display:"none" }}
            onChange={(e) => handleFiles(e.target.files)} />
          {/* 隠しinput(ライブラリ) — multiple=true で最大4枚 */}
          <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp"
            multiple style={{ display:"none" }}
            onChange={(e) => handleFiles(e.target.files)} />

          <button className="hanko-btn" onClick={() => fileRef.current?.click()}
            disabled={scanning} aria-label="カメラで撮影">
            {scanning
              ? <span className="spinner" aria-hidden="true" />
              : <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>}
            <span style={{ fontSize:13, fontWeight:700, letterSpacing:"0.08em" }}>
              {scanning ? "解析中" : "撮影"}
            </span>
          </button>

          <p style={st.scanHint}>カメラで1枚ずつ、またはライブラリから最大4枚まで同時に選択できます</p>

          <button className="text-btn" onClick={() => galleryRef.current?.click()} disabled={scanning}>
            写真ライブラリから選択（最大4枚）
          </button>

          {globalError && <div style={st.errorBox}>{globalError}</div>}
        </section>

        {/* ── 処理中インジケーター ── */}
        {scanning && drafts.length > 0 && (
          <section style={st.progressSection}>
            <div style={st.progressTitle}>
              {drafts.filter(d=>d.status==="done").length} / {drafts.length} 枚 解析完了
            </div>
            <div style={st.progressGrid}>
              {drafts.map((d, i) => (
                <div key={d.id} style={{
                  ...st.progressItem,
                  background: d.status==="done" ? "#EAF5EC" : d.status==="error" ? "#FBEAE7" : "#F2F0EA"
                }}>
                  <span style={st.progressNum}>{i+1}</span>
                  <span style={{ fontSize:13 }}>
                    {d.status==="processing" ? "解析中…" : d.status==="done" ? "✓ 完了" : "✕ エラー"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── ドラフト確認・編集パネル ── */}
        {!scanning && drafts.length > 0 && (
          <section style={st.draftSection}>
            <div style={st.draftHeader}>
              <div>
                <span style={st.draftTitle}>{drafts.length}枚の読み取り結果</span>
                {errorDrafts.length > 0 &&
                  <span style={st.errorBadge}>{errorDrafts.length}枚 失敗</span>}
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button className="ghost-btn" onClick={() => setDrafts([])}>
                  すべて破棄
                </button>
                {okDrafts.length > 0 &&
                  <button className="primary-btn" onClick={saveAllDrafts}>
                    {okDrafts.length}枚をまとめて登録
                  </button>}
              </div>
            </div>

            <div style={st.draftList}>
              {drafts.map((d, i) => (
                <div key={d.id} className="draft-card" style={{
                  borderLeft: `3px solid ${d.status==="error" ? VERMILION : d.status==="done" ? "#2E7D46" : "#CCC"}`
                }}>
                  {/* カードヘッダー */}
                  <div style={st.draftCardTop}
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => e.key==="Enter" && setExpandedIdx(expandedIdx===i ? null : i)}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={st.draftCardNum}>{i+1}</span>
                      <div>
                        {d.status === "error"
                          ? <div style={{ fontSize:13, color:VERMILION }}>{d.error}</div>
                          : <>
                              <div style={st.draftCardName}>{d.card.name || "（氏名なし）"}</div>
                              <div style={st.draftCardCompany}>{d.card.company || "（会社名なし）"}</div>
                            </>}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {d.status === "done" &&
                        <button className="icon-btn" style={{ background:"#EAF5EC", color:"#1E5631" }}
                          onClick={(e) => { e.stopPropagation(); const stamp=nowStamp(); persist([{ ...d.card, id:`card_${Date.now()}`, createdAt:stamp }, ...cards]); removeDraft(d.id); }}>
                          この1枚を登録
                        </button>}
                      <button className="icon-btn danger"
                        onClick={(e) => { e.stopPropagation(); removeDraft(d.id); }}>
                        削除
                      </button>
                      <span style={{ fontSize:18, color:"#999", transform: expandedIdx===i ? "rotate(180deg)":"rotate(0deg)", transition:"0.2s" }}>▾</span>
                    </div>
                  </div>

                  {/* 展開した編集フォーム */}
                  {expandedIdx === i && d.status === "done" && (
                    <div style={st.draftForm}>
                      {FIELDS.map((f) => (
                        <label key={f.key} style={st.fieldRow}>
                          <span style={st.fieldLabel}>{f.label}</span>
                          <input className="field-input" value={d.card[f.key] || ""}
                            onChange={(e) => updateDraftField(d.id, f.key, e.target.value)} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 検索・CSV ── */}
        {cards.length > 0 && (
          <section style={st.toolbar}>
            <input className="field-input" style={{ flex:1 }}
              placeholder="氏名・会社名などで検索" value={query}
              onChange={(e) => setQuery(e.target.value)} />
            <button className="primary-btn" onClick={() => exportCsv(cards)}>CSV出力</button>
          </section>
        )}

        {/* ── 既存カード一覧 ── */}
        <section style={st.list}>
          {loaded && cards.length === 0 && drafts.length === 0 && (
            <div style={st.empty}>
              <div style={st.emptyTitle}>まだ名刺が登録されていません</div>
              <div style={st.emptyText}>上のボタンから1枚目をスキャンしましょう</div>
            </div>
          )}
          {filtered.map((c) => (
            <article key={c.id} className="meishi-card">
              {editingCardId === c.id
                ? /* 編集モード */
                  <EditCard card={c} onSave={saveEdit} onCancel={() => setEditingCardId(null)} />
                : /* 表示モード */
                  <>
                    <div style={st.cardTop}>
                      <div style={{ minWidth:0 }}>
                        <div style={st.cardCompany}>{c.company || "（会社名なし）"}</div>
                        <div style={st.cardName}>
                          {c.name || "（氏名なし）"}
                          {c.kana && <span style={st.cardKana}>{c.kana}</span>}
                        </div>
                        {(c.department || c.title) &&
                          <div style={st.cardRole}>{[c.department, c.title].filter(Boolean).join(" / ")}</div>}
                      </div>
                      <div style={st.cardActions}>
                        <button className="icon-btn" onClick={() => setEditingCardId(c.id)}>編集</button>
                        <button className="icon-btn danger" onClick={() => deleteCard(c.id)}>削除</button>
                      </div>
                    </div>
                    <div style={st.cardDetail}>
                      {c.tel    && <span>TEL {c.tel}</span>}
                      {c.mobile && <span>携帯 {c.mobile}</span>}
                      {c.email  && <span>{c.email}</span>}
                      {c.address && <span>{[c.zip, c.address].filter(Boolean).join(" ")}</span>}
                    </div>
                    {c.createdAt && <div style={st.cardDate}>登録: {c.createdAt}</div>}
                  </>}
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

// ── 既存カード編集コンポーネント ─────────────────────────
function EditCard({ card, onSave, onCancel }) {
  const [form, setForm] = useState({ ...card });
  return (
    <div>
      {FIELDS.map((f) => (
        <label key={f.key} style={{ ...st.fieldRow, marginBottom:8 }}>
          <span style={st.fieldLabel}>{f.label}</span>
          <input className="field-input" value={form[f.key] || ""}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        </label>
      ))}
      <div style={{ display:"flex", gap:10, marginTop:12 }}>
        <button className="ghost-btn" onClick={onCancel}>キャンセル</button>
        <button className="primary-btn" onClick={() => onSave(form)}>保存</button>
      </div>
    </div>
  );
}

// ── スタイル定義 ──────────────────────────────────────────
const INDIGO    = "#1F2A44";
const WASHI     = "#F7F5F0";
const VERMILION = "#C8351F";
const INK       = "#2B2B2B";

const st = {
  page:          { minHeight:"100vh", background:WASHI, color:INK, fontFamily:"'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif" },
  header:        { background:INDIGO, color:"#FFF" },
  headerInner:   { maxWidth:720, margin:"0 auto", padding:"20px 20px 18px", display:"flex", justifyContent:"space-between", alignItems:"flex-end" },
  eyebrow:       { fontSize:10, letterSpacing:"0.22em", opacity:0.65, marginBottom:4 },
  h1:            { fontSize:22, fontWeight:700, margin:0, letterSpacing:"0.04em" },
  counter:       { textAlign:"right", lineHeight:1.1 },
  counterNum:    { fontSize:26, fontWeight:700, fontVariantNumeric:"tabular-nums" },
  counterLabel:  { fontSize:11, marginLeft:4, opacity:0.7 },
  main:          { maxWidth:720, margin:"0 auto", padding:"24px 16px 40px" },
  scanSection:   { textAlign:"center", padding:"8px 0 20px" },
  scanHint:      { fontSize:13, color:"#666", margin:"14px 0 6px" },
  errorBox:      { margin:"14px auto 0", maxWidth:480, background:"#FBEAE7", border:`1px solid ${VERMILION}`, color:"#8C2516", borderRadius:8, padding:"10px 14px", fontSize:13, textAlign:"left", whiteSpace:"pre-wrap" },
  progressSection: { background:"#FFF", border:"1px solid #EDE9DF", borderRadius:10, padding:"14px 16px", marginBottom:20 },
  progressTitle: { fontWeight:700, fontSize:14, marginBottom:10 },
  progressGrid:  { display:"flex", gap:8, flexWrap:"wrap" },
  progressItem:  { display:"flex", alignItems:"center", gap:8, padding:"8px 14px", borderRadius:8, border:"1px solid #E0DBD1" },
  progressNum:   { width:22, height:22, borderRadius:"50%", background:INDIGO, color:"#FFF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, flexShrink:0 },
  draftSection:  { background:"#FFF", border:"1px solid #EDE9DF", borderRadius:10, padding:"16px", marginBottom:20 },
  draftHeader:   { display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:14 },
  draftTitle:    { fontWeight:700, fontSize:16 },
  errorBadge:    { marginLeft:8, background:VERMILION, color:"#FFF", borderRadius:4, padding:"2px 8px", fontSize:12 },
  draftList:     { display:"flex", flexDirection:"column", gap:10 },
  draftCardTop:  { display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"10px 12px", cursor:"pointer", userSelect:"none" },
  draftCardNum:  { width:26, height:26, borderRadius:"50%", background:INDIGO, color:"#FFF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, flexShrink:0 },
  draftCardName: { fontWeight:700, fontSize:16 },
  draftCardCompany: { fontSize:12, color:"#6B6557" },
  draftForm:     { padding:"12px 16px 16px", borderTop:"1px solid #EDE9DF", display:"flex", flexDirection:"column", gap:10 },
  toolbar:       { display:"flex", gap:10, marginBottom:18 },
  list:          { display:"flex", flexDirection:"column", gap:14 },
  empty:         { textAlign:"center", padding:"44px 16px", border:"1px dashed #C9C4B8", borderRadius:10 },
  emptyTitle:    { fontWeight:700, fontSize:15, marginBottom:6 },
  emptyText:     { fontSize:13, color:"#777" },
  cardTop:       { display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 },
  cardCompany:   { fontSize:12, color:"#6B6557", letterSpacing:"0.04em" },
  cardName:      { fontSize:18, fontWeight:700, margin:"2px 0", display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" },
  cardKana:      { fontSize:11, color:"#888", fontWeight:400 },
  cardRole:      { fontSize:12.5, color:"#555" },
  cardActions:   { display:"flex", gap:6, flexShrink:0 },
  cardDetail:    { marginTop:10, paddingTop:10, borderTop:"1px solid #EDE9DF", display:"flex", flexWrap:"wrap", gap:"4px 16px", fontSize:12.5, color:"#444" },
  cardDate:      { marginTop:8, fontSize:10.5, color:"#A39E92" },
  fieldRow:      { display:"flex", flexDirection:"column", gap:4 },
  fieldLabel:    { fontSize:11.5, color:"#777", fontWeight:600 },
  footer:        { textAlign:"center", fontSize:11, color:"#A39E92", padding:"0 16px 28px" },
};

const css = `
  * { box-sizing: border-box; }
  .hanko-btn { width:96px; height:96px; border-radius:50%; background:${VERMILION}; color:#FFF; border:none; display:inline-flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; cursor:pointer; box-shadow:0 4px 14px rgba(200,53,31,0.35),inset 0 0 0 3px rgba(255,255,255,0.25); transition:transform 0.12s ease; }
  .hanko-btn:active { transform:scale(0.94); }
  .hanko-btn:disabled { opacity:0.7; cursor:wait; }
  .spinner { width:30px; height:30px; border-radius:50%; border:3px solid rgba(255,255,255,0.35); border-top-color:#FFF; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .text-btn { background:none; border:none; color:${INDIGO}; font-size:13px; text-decoration:underline; cursor:pointer; padding:6px; }
  .text-btn:disabled { opacity:0.5; }
  .primary-btn { background:${INDIGO}; color:#FFF; border:none; border-radius:8px; padding:11px 18px; font-size:14px; font-weight:700; cursor:pointer; flex-shrink:0; white-space:nowrap; }
  .primary-btn:active { opacity:0.85; }
  .ghost-btn { background:none; border:1px solid #CCC; border-radius:8px; padding:11px 18px; font-size:14px; cursor:pointer; color:#555; white-space:nowrap; }
  .field-input { border:1px solid #D8D3C8; border-radius:8px; padding:10px 12px; font-size:15px; width:100%; background:#FFF; color:${INK}; }
  .field-input:focus { outline:2px solid ${INDIGO}; border-color:${INDIGO}; }
  .meishi-card { background:#FFF; border-radius:6px; padding:16px 18px; box-shadow:0 1px 3px rgba(31,42,68,0.10),0 4px 10px rgba(31,42,68,0.04); border-left:3px solid ${VERMILION}; }
  .draft-card { background:#FAFAF8; border-radius:8px; overflow:hidden; }
  .icon-btn { background:#F2F0EA; border:none; border-radius:6px; padding:6px 10px; font-size:11.5px; cursor:pointer; color:#555; white-space:nowrap; }
  .icon-btn.danger { background:${VERMILION}; color:#FFF; }
`;
