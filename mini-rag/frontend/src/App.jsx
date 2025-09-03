import React, { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import Uploader from "./Upload";

// backend-link
const API = (process.env.REACT_APP_API?.replace(/\/$/, "")) || "http://localhost:4000";

export default function App() {
  const [query, setQuery] = useState("");
  const [answerHtml, setAnswerHtml] = useState("");
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({
    ms: 0,
    tokens: { in: 0, out: 0, total: 0 },
    cost: { gen: 0, emb: 0, total: 0 }
  });
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("theme");
    if (stored) return stored;
    // auto-detect OS theme
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [showDebug, setShowDebug] = useState(false);
  const [rawResponse, setRawResponse] = useState(null);

  const taRef = useRef(null);

  // toggle-theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  // use default os theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const stored = localStorage.getItem("theme");
      if (!stored) setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  const canAsk = useMemo(() => query.trim().length > 0 && !loading, [query, loading]);

  // USD to INR Converter
  const USD_INR = Number(process.env.REACT_APP_USD_INR || 88);

  const [copied, setCopied] = useState(false);

  function formatINR(usd, { min = 2, max = 4 } = {}) {
    const v = Number(usd);
    if (!Number.isFinite(v)) return "—";
    const inr = v * USD_INR;

    const abs = Math.abs(inr);
    let fractionDigits =
      abs >= 1 ? 2 :
        abs >= 0.1 ? 3 :
          abs >= 0.01 ? 3 : 4;
    fractionDigits = Math.min(Math.max(fractionDigits, min), max);

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(inr);
  }


  function copyAnswer() {
    const txt = stripHtml(answerHtml);
    navigator.clipboard.writeText(txt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => { });
  }


  async function ask() {
    if (!canAsk) return;
    setLoading(true);
    setError("");
    setAnswerHtml("");
    setSources([]);
    setRawResponse(null);

    const t0 = performance.now();
    try {
      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);

      const data = await res.json();
      setRawResponse(data);

      // timing
      const ms = Number.isFinite(data?.durationMs)
        ? Math.round(data.durationMs)
        : Math.round(performance.now() - t0);

      // usage
      const inTok = data?.usage?.promptTokenCount ?? 0;
      const outTok = data?.usage?.candidatesTokenCount ?? 0;
      const totalTok = data?.usage?.totalTokenCount ?? (inTok + outTok);


      // cost estimate 
      const genCost = Number(data?.costEstimate?.generation?.total);
      const embCost = Number(data?.costEstimate?.embedding?.cost);
      const totalCost = Number(data?.costEstimate?.totalUsd);


      // answer
      const html = data.answerHtml || linkifyCitations(escapeHtml(data.answer || "No answer."));
      const srcs = Array.isArray(data.sources)
        ? data.sources.map(normalizeSource)
        : [];

      setAnswerHtml(html);
      setSources(srcs);
      setMeta({
        ms,
        tokens: { in: inTok, out: outTok, total: totalTok },
        cost: { gen: genCost, emb: embCost, total: totalCost }
      });
    } catch (e) {
      setError(e?.message?.slice(0, 400) || "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  function normalizeSource(s, i) {
    if (typeof s === "string") {
      return {
        num: i + 1,
        title: `Source #${i + 1}`,
        snippet: s,
        url: "",
        section: "",
        page: undefined,
        score: undefined,
        position: i
      };
    }
    return {
      num: s.num ?? (i + 1),
      title: s.meta?.title || s.title || s.source || `Source #${i + 1}`,
      snippet: s.text || s.snippet || "",
      url: s.meta?.url || s.url || s.link || "",
      section: s.meta?.section || s.section || s.heading || "",
      page: s.page,
      score: s.score ?? s.relevance_score,
      position: s.meta?.chunk ?? s.position ?? i
    };
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask();
  }

  return (
    <div className="min-h-full grid grid-rows-[auto_1fr_auto]">
      {/* Topbar */}
      <header className="backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="font-bold tracking-tight">
          <span className="text-blue-600 dark:text-blue-400 mr-1">●</span> Mini-RAG
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-white/10"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            title="Toggle theme"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <a
            href="https://github.com/Ascrion/mini-rag.git"
            target="_blank" rel="noreferrer"
            className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-white/10"
            title="Open repo"
          >
            ⎋
          </a>
        </div>
      </header>

      {/* Content */}
      <main
        className="w-full"
        style={{ background: "var(--bg-grad), var(--tw-gradient-to)" }}
      >
        <div className="mx-auto max-w-[1100px] px-4 py-6 grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Main */}
          <section className="min-w-0">
            {/* Ask panel */}
            <div className="bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-panel dark:shadow-panelDark
                text-slate-900 dark:text-slate-100">
              <h1 className="text-xl font-semibold mb-3 text-slate-900 dark:text-slate-100">
                Ask your docs
              </h1>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                <textarea
                  ref={taRef}
                  rows={4}
                  placeholder="Ask a question about the indexed documents…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  className="min-h-[96px] max-h-[300px] w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800 bg-transparent p-3
                 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/60"
                />
                <div className="flex gap-2">
                  <button
                    onClick={ask}
                    disabled={!canAsk}
                    className="disabled:opacity-60 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-semibold text-white
                               bg-gradient-to-b from-blue-500 to-blue-600 shadow-[0_6px_18px_rgba(59,130,246,.35)]"
                    aria-busy={loading}
                  >
                    {loading ? "Thinking…" : "Ask"}
                  </button>
                  <button
                    onClick={() => setQuery("")}
                    disabled={loading || !query}
                    title="Clear"
                    className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/10 disabled:opacity-60"
                  >
                    ⟲
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 rounded-xl border border-red-500/40 bg-red-50/60 dark:bg-red-500/10 p-4">
                <strong>Request failed:</strong> {error}
              </div>
            )}

            {/* Answer */}
            {Boolean(answerHtml) && (
              <div className="mt-4 bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-panel dark:shadow-panelDark text-slate-900 dark:text-slate-100">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Answer</h2>
                  <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                    <Badge>⏱ {meta.ms} ms</Badge>
                    <Badge> in:{meta.tokens.in} · out:{meta.tokens.out} · total:{meta.tokens.total} </Badge>
                    <Badge>
                      cost: {formatINR(meta.cost?.total)}
                    </Badge>

                    <button
                      onClick={copyAnswer}
                      className="relative rounded-md border border-slate-200 dark:border-slate-800 px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/10"
                      title="Copy answer"
                    >
                      {copied ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                </div>

                <div
                  className="answer-body mt-3 text-[16px] leading-6"
                  dangerouslySetInnerHTML={{ __html: withAnchors(answerHtml) }}
                />

                {/* Sources and metadata */}
                {sources.length > 0 && (
                  <details className="mt-4 group">
                    <summary className="cursor-pointer select-none list-none text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-slate-300 dark:border-slate-700 text-[11px]">i</span>
                      Sources &amp; metadata
                      <span className="text-slate-400 dark:text-slate-500 text-xs ml-1 group-open:hidden">[show]</span>
                      <span className="text-slate-400 dark:text-slate-500 text-xs ml-1 hidden group-open:inline">[hide]</span>
                    </summary>
                    <ol className="mt-3 pl-5 list-decimal">
                      {sources.map((s, i) => (
                        <li key={i} id={`src-${i + 1}`} className="my-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-slate-200 dark:border-slate-800 bg-blue-500/10 text-sm font-semibold">[{i + 1}]</span>
                            <span className="font-medium">{s.title}</span>
                            {typeof s.score === "number" && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 rounded-full border border-slate-200 dark:border-slate-800 px-2 py-0.5">
                                {s.score.toFixed(3)}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
                            {s.section && <span>§ {s.section}</span>}
                            {Number.isFinite(s.page) && <span>p.{s.page}</span>}
                            <span>chunk #{s.position}</span>
                            {s.url && (
                              <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
                                open ↗
                              </a>
                            )}
                          </div>
                          {s.snippet && (
                            <blockquote className="mt-2 text-slate-800 dark:text-slate-200">{s.snippet}</blockquote>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {copied && (
                  <div className="pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-8 z-50">
                    <div className="rounded-full bg-slate-900/85 text-white dark:bg-white/90 dark:text-slate-900 px-3 py-1 text-xs shadow">
                      Copied to clipboard
                    </div>
                  </div>
                )}

                {/* Debug */}
                {/* <details className="mt-3">
                  <summary onClick={() => setShowDebug(v => !v)} className="cursor-pointer text-slate-500 dark:text-slate-400">
                    Debug
                  </summary>
                  {showDebug && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded border border-dashed border-slate-300 dark:border-slate-700 p-3 text-xs">
                      {JSON.stringify(rawResponse, null, 2)}
                    </pre>
                  )}
                </details> */}
              </div>
            )}

            {/* Placeholder */}
            {!answerHtml && !error && (
              <div className="mt-4 bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-slate-600 dark:text-slate-400 shadow-panel dark:shadow-panelDark">
                <p>Ask a question to get an answer</p>
                <p className="text-sm opacity-80">Please wait 15 seconds on initial boot for backend to start</p>
                <p className="text-sm opacity-80">Powered by Gemini • Pinecone • Cohere</p>
              </div>
            )}
          </section>

          {/* Sidebar */}
          <aside className="lg:sticky lg:top-20 h-fit min-w-0">
            <div className="bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-panel dark:shadow-panelDark">
              <Uploader apiBase={API} />
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

// code helpers
function escapeHtml(str = "") {
  return str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function stripHtml(html = "") {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}
function linkifyCitations(text = "") {
  return text.replace(/(?<!>)\[(\d+)\](?!<\/a>)/g, (_m, n) => `<a href="#src-${n}" class="cite">[${n}]</a>`);
}
function withAnchors(html = "") {
  return html.replace(/(?<!>)\[(\d+)\](?!<\/a>)/g, (_m, n) => `<a href="#src-${n}" className="cite">[${n}]</a>`);
}

function Badge({ children }) {
  return (
    <span className="rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-white/10 px-2 py-0.5">
      {children}
    </span>
  );
}
