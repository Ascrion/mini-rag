import React, { useState } from "react";

export default function Uploader({ apiBase = "http://localhost:3000" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  function plural(n, s, p = s + "s") {
    return `${n} ${n === 1 ? s : p}`;
  }

  // Insert documents to Pinecone
  async function upsert() {
    if (!text.trim()) return;
    setBusy(true);
    setStatus("Uploading…");
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docs: [
            {
              id: Date.now().toString(),
              text,
              source: "manual",
              title: "User Input",
              section: "",
              position: 0,
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upsert failed");

      const n =
        data?.totalChunks ??
        data?.totalVectors ??
        data?.count ??
        0;

      const ms = data?.durationMs;
      setStatus(
        `Added ${plural(n, "chunk")} to index${typeof ms === "number" ? ` in ${ms}ms` : ""}.`
      );
      setText("");
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Delete all stored documents
  async function resetIndex() {
    if (!confirm("Reset all documents?")) return;
    setBusy(true);
    setStatus("Resetting documents…");
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const statusText = data?.status || "ok";
      const cleared = Array.isArray(data?.namespaces_cleared)
        ? data.namespaces_cleared.join(", ")
        : null;
      const ms = data?.durationMs;

      setStatus(
        statusText === "deleted_all"
          ? `All documents deleted${cleared ? ` (namespaces: ${cleared})` : ""}${typeof ms === "number" ? ` in ${ms}ms` : ""}.`
          : `Reset attempted, but some data remains. See server logs.${typeof ms === "number" ? ` (${ms}ms)` : ""}`
      );
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-panel dark:shadow-panelDark p-4">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Add Documents To Improve Accuracy
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          All documents go into the default index
        </p>
      </div>

      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste document text here…"
        className="w-full resize-y rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="mt-3 flex gap-2">
        <button
          onClick={upsert}
          disabled={busy || !text.trim()}
          className="flex-1 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add to Index"}
        </button>

        <button
          onClick={() => setText("")}
          disabled={busy || !text}
          className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>

        <button
          onClick={resetIndex}
          disabled={busy}
          className="rounded-lg border border-rose-300 dark:border-rose-600 px-4 py-2 text-sm text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          title="Delete all vectors in the index"
        >
          Reset Docs
        </button>
      </div>

      {status && (
        <div className="mt-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
          {status}
        </div>
      )}
    </section>
  );
}
