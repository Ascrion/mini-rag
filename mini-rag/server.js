// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { Pinecone } from "@pinecone-database/pinecone";
import { randomUUID } from "crypto";

dotenv.config();

// ENV Initialization 
const REQUIRED_ENV = [
  "PINECONE_API_KEY",
  "PINECONE_INDEX",
  "GOOGLE_API_KEY",
  "COHERE_API_KEY",
  "GEMINI_INPUT_USD_PER_1K",
  "GEMINI_OUTPUT_USD_PER_1K",
  "EMBEDDING_USD_PER_1K"
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    "[BOOT] Missing required env keys:",
    missing.join(", "),
    "— server will start but some features may fail."
  );
} else {
  console.log("[BOOT] All required env vars present.");
}
console.log("[BOOT] NODE_ENV:", process.env.NODE_ENV || "(not set)");

// Express Handling 
const app = express();

const allowedOrigins = [
  /^https?:\/\/localhost(?::\d+)?$/,           
  "https://mini-rag-frontend.onrender.com",  
];

function isAllowedOrigin(origin) {
  if (!origin) return true; 
  return allowedOrigins.some((entry) =>
    typeof entry === "string" ? entry === origin : entry.test(origin)
  );
}

const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// CORS Pre-flight response
app.options("*", cors(corsOptions));

app.use(bodyParser.json({ limit: "2mb" }));

// Request Handling
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  req._startedAt = Date.now();
  console.log(
    `[REQ  ${req.requestId}] ${req.method} ${req.originalUrl} — ip=${req.ip}`
  );
  if (req.body && Object.keys(req.body).length) {
    const preview = JSON.stringify(req.body).slice(0, 800);
    console.log(
      `[REQ  ${req.requestId}] body: ${preview}${
        preview.length === 800 ? "…(truncated)" : ""
      }`
    );
  }
  next();
});

// Rate limiter - 30/min per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  skip: (req) => req.method === "OPTIONS",
  handler: (req, res) => {
    console.warn(`[RATE ${req.requestId}] Too many requests from ip=${req.ip}`);
    res.status(429).json({ error: "Too many requests. Please slow down." });
  },
});
app.use(limiter);


// Response time logs
app.use((req, res, next) => {
  const end = res.end;
  res.end = function (...args) {
    const ms = Date.now() - (req._startedAt || Date.now());
    console.log(
      `[RESP ${req.requestId}] status=${res.statusCode} durationMs=${ms}`
    );
    return end.apply(this, args);
  };
  next();
});

// Pinecone connection
console.log("[PINECONE] Initializing client…");
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = process.env.PINECONE_INDEX;
const index = pc.index(indexName);
console.log("[PINECONE] Connected to index:", indexName);

// Data Handling
function chunkText(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += Math.max(1, chunkSize - overlap);
  }
  return chunks;
}

function cleanMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const strings = v.filter((x) => typeof x === "string");
      if (strings.length) out[k] = strings;
      continue;
    }
    if (["string", "number", "boolean"].includes(typeof v)) {
      out[k] = v;
    }
  }
  return out;
}

async function embedText(text, requestId = "") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`;
  const t0 = Date.now();
  try {
    const res = await axios.post(
      url,
      { content: { parts: [{ text }] } },
      { timeout: 15000 }
    );
    const vec = res.data?.embedding?.values;
    if (!Array.isArray(vec)) throw new Error("Bad embedding shape from Gemini");
    const ms = Date.now() - t0;
    console.log(
      `[EMB  ${requestId}] length=${text.length} dims=${vec.length} durationMs=${ms}`
    );
    return vec;
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(
      `[EMB  ${requestId}] FAILED durationMs=${ms}`,
      err?.response?.data || err.message
    );
    throw err;
  }
}

function parseModelJson(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// Cost Calculator
function dollars(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

// gemini UsageData (tokens)
function estimateGeminiCost(usage) {
  const inPer1k = Number(process.env.GEMINI_INPUT_USD_PER_1K || 0);
  const outPer1k = Number(process.env.GEMINI_OUTPUT_USD_PER_1K || 0);
  const inTok = usage?.promptTokenCount || 0;
  const outTok = usage?.candidatesTokenCount || 0;
  const inCost = (inTok / 1000) * inPer1k;
  const outCost = (outTok / 1000) * outPer1k;
  return {
    inTok,
    outTok,
    inCost: dollars(inCost),
    outCost: dollars(outCost),
    total: dollars(inCost + outCost),
  };
}

// embedding estimate
function estimateEmbeddingCost(charCount) {
  const per1k = Number(process.env.EMBEDDING_USD_PER_1K || 0);
  const approxTokens = Math.ceil((charCount || 0) / 4); // ~4 chars/token heuristic
  const cost = (approxTokens / 1000) * per1k;
  return { approxTokens, cost: dollars(cost) };
}

// Cohere Reranker 
async function rerank(query, documents, requestId = "") {
  if (!process.env.COHERE_API_KEY) {
    console.log(`[RER  ${requestId}] Cohere API key not set — skipping rerank`);
    return documents;
  }

  const norm = (documents || [])
    .map((d, i) => {
      if (typeof d === "string") return { text: d, _origIndex: i, _orig: d };
      if (d && typeof d.text === "string")
        return { text: d.text, _origIndex: i, _orig: d };
      return { text: "", _origIndex: i, _orig: d };
    })
    .filter((x) => x.text);

  if (norm.length === 0) {
    console.log(`[RER  ${requestId}] No documents to rerank — skipping`);
    return documents;
  }

  const t0 = Date.now();
  try {
    const res = await axios.post(
      "https://api.cohere.ai/v1/rerank",
      {
        query,
        documents: norm.map((d, i) => ({ id: String(i), text: d.text })),
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const results = Array.isArray(res.data?.results) ? res.data.results : [];
    results.sort(
      (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    );

    const reordered = results.map((r) => norm[r.index]?._orig).filter(Boolean);

    if (reordered.length < documents.length) {
      const used = new Set(reordered);
      for (const d of documents) if (!used.has(d)) reordered.push(d);
    }

    const ms = Date.now() - t0;
    console.log(
      `[RER  ${requestId}] reranked=${reordered.length} durationMs=${ms}`
    );
    return reordered;
  } catch (err) {
    const ms = Date.now() - t0;
    console.warn(
      `[RER  ${requestId}] FAILED durationMs=${ms} — fallback to Pinecone order`,
      err?.message || err
    );
    return documents;
  }
}

// Routing
app.get("/", (_req, res) => {
  res.send("Mini RAG server is alive");
});

// Ensure server operation
app.get("/health", async (_req, res) => {
  try {
    const stats = await index.describeIndexStats();
    res.json({
      ok: true,
      index: indexName,
      namespaces: Object.keys(stats?.namespaces || {}),
    });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: e?.message || "health failed" });
  }
});

// Upsert documents into namespaces
app.post("/upsert", async (req, res) => {
  const rid = req.requestId;
  const t0 = Date.now();
  try {
    const { docs } = req.body;
    if (!Array.isArray(docs) || docs.length === 0) {
      console.warn(`[UPS  ${rid}] Empty docs array`);
      return res
        .status(400)
        .json({ error: "Body should be { docs: [{id, text}, ...] }" });
    }

    const ns = index.namespace("default");
    let totalChunks = 0;
    let totalVectors = 0;
    let embedCharSum = 0;

    for (const doc of docs) {
      if (!doc?.id || !doc?.text) {
        console.warn(`[UPS  ${rid}] Skipping doc missing id/text`);
        continue;
      }

      const docId = String(doc.id);
      console.log(`[UPS  ${rid}] Purging old vectors for docId="${docId}"`);
      try {
        
        if (typeof ns.deleteMany === "function") {
          await ns.deleteMany({ filter: { docId: { $eq: docId } } });
        } else {
          // Legacy
          await ns.delete({
            deleteAll: false,
            filter: { docId: { $eq: docId } },
          });
        }
      } catch (e) {
        console.warn(
          `[UPS  ${rid}] Purge failed for docId="${docId}"`,
          e?.response?.data || e.message
        );
      }

      const chunks = chunkText(doc.text);
      console.log(
        `[UPS  ${rid}] docId="${docId}" chunkCount=${chunks.length} (title=${
          doc.title || "n/a"
        })`
      );

      const vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        const values = await embedText(chunks[i], rid);
        embedCharSum += chunks[i].length;
        const metadata = cleanMeta({
          text: chunks[i],
          docId,
          chunk: i,
          title: doc.title,
          url: doc.url,
          source: doc.source,
          section: doc.section,
          position: doc.position,
        });
        vectors.push({ id: `${docId}::${i}`, values, metadata });
      }

      if (vectors.length) {
        console.log(
          `[UPS  ${rid}] Upserting vectors for docId="${docId}" count=${vectors.length}`
        );
        await ns.upsert(vectors);
        totalVectors += vectors.length;
        totalChunks += chunks.length;
      }
    }

    const ms = Date.now() - t0;
    const embCost = estimateEmbeddingCost(embedCharSum);

    console.log(
      `[UPS  ${rid}] DONE totalDocs=${docs.length} totalChunks=${totalChunks} totalVectors=${totalVectors} durationMs=${ms} ` +
        `embTokens≈${embCost.approxTokens} embCost≈$${embCost.cost}`
    );

    res.json({
      status: "upserted",
      totalDocs: docs.length,
      totalChunks,
      totalVectors,
      durationMs: ms,
      costEstimate: { embedding: embCost, totalUsd: embCost.cost },
      count: totalChunks, // alias for older UIs
    });
  } catch (e) {
    const msg = e?.response?.data || e.message || "Upsert failed";
    console.error(`[UPS  ${rid}] ERROR`, msg);
    res.status(500).json({ error: e?.message || "Upsert failed" });
  }
});

// Reset all namespaces
app.post("/reset", async (req, res) => {
  const rid = req.requestId;
  const t0 = Date.now();

  async function nukeNamespace(ns) {
    try {
      // Preferred
      if (typeof index.namespace(ns).deleteAll === "function") {
        await index.namespace(ns).deleteAll();
      } else {
        // Legacy
        await index.delete({ deleteAll: true, namespace: ns });
      }
      console.log(`[RST  ${rid}] Cleared namespace="${ns || "(root)"}"`);
      return true;
    } catch (e) {
      console.warn(
        `[RST  ${rid}] Failed clearing namespace="${ns || "(root)"}"`,
        e?.response?.data || e.message
      );
      return false;
    }
  }

  try {
    const stats = await index.describeIndexStats();
    const listed = Object.keys(stats?.namespaces || {}); 
    const candidates = new Set(listed);
    candidates.add(""); // 
    candidates.add("default");

    console.log(
      `[RST  ${rid}] Namespaces (pre):`,
      [...candidates].join(", ") || "(none)"
    );

    const cleared = [];
    for (const ns of candidates) {
      const ok = await nukeNamespace(ns);
      if (ok) cleared.push(ns || "(root)");
    }

    // Poll for emptiness (eventual consistency)
    const deadline = Date.now() + 7000;
    let remaining = [];
    while (Date.now() < deadline) {
      const after = await index.describeIndexStats();
      remaining = Object.entries(after?.namespaces || {})
        .filter(([, v]) => (v?.vectorCount ?? v?.recordCount ?? 0) > 0)
        .map(([k]) => k);
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    const ms = Date.now() - t0;
    if (remaining.length) {
      console.warn(
        `[RST  ${rid}] Attempted reset but remaining namespaces have data: ${remaining.join(
          ", "
        )} durationMs=${ms}`
      );
      return res.status(200).json({
        status: "attempted_but_remaining",
        cleared,
        remaining,
        durationMs: ms,
      });
    }

    console.log(
      `[RST  ${rid}] DONE cleared=${cleared.join(", ")} durationMs=${ms}`
    );
    res.json({
      status: "deleted_all",
      namespaces_cleared: cleared,
      durationMs: ms,
    });
  } catch (e) {
    const msg = e?.response?.data?.message || e.message || "Reset failed";
    console.error(`[RST  ${rid}] ERROR`, msg);
    res.status(500).json({ error: msg });
  }
});

// Check all namespaces
app.get("/pc/namespaces", async (req, res) => {
  const rid = req.requestId;
  try {
    const stats = await index.describeIndexStats();
    console.log(
      `[STAT ${rid}] namespaces:`,
      Object.keys(stats?.namespaces || {}).join(", ")
    );
    res.json({ namespaces: stats?.namespaces ?? {} });
  } catch (e) {
    console.error(`[STAT ${rid}] ERROR`, e?.message);
    res.status(500).json({ error: e?.message || "stats failed" });
  }
});

// Stats
app.get("/pc/stats", async (req, res) => {
  const rid = req.requestId;
  try {
    const stats = await index.describeIndexStats();
    res.json({ namespaces: stats?.namespaces ?? {} });
  } catch (e) {
    console.error(`[STAT ${rid}] ERROR`, e?.message);
    res.status(500).json({ error: e?.message || "stats failed" });
  }
});

// Query (ask LLM questions)
app.post("/query", async (req, res) => {
  const rid = req.requestId;
  const started = Date.now();

  try {
    const { query, topK = 8 } = req.body;
    if (!query || typeof query !== "string") {
      console.warn(`[QRY  ${rid}] Missing or invalid 'query'`);
      return res
        .status(400)
        .json({ error: "Body should be { query: string }" });
    }

    console.log(
      `[QRY  ${rid}] topK=${topK} query="${query.slice(0, 120)}${
        query.length > 120 ? "…" : ""
      }"`
    );

    // query embedding
    const tEmb = Date.now();
    const queryEmbedding = await embedText(query, rid);
    console.log(
      `[QRY  ${rid}] Embedding dims=${queryEmbedding.length} durationMs=${
        Date.now() - tEmb
      }`
    );

    // Pinecone Retreival
    const tPine = Date.now();
    const search = await index.namespace("default").query({
      topK,
      vector: queryEmbedding,
      includeMetadata: true,
    });
    const pineMs = Date.now() - tPine;
    console.log(
      `[QRY  ${rid}] Pinecone matches=${search?.matches?.length || 0} durationMs=${pineMs}`
    );

    // Source handling
    let sources = (search?.matches || [])
      .map((m, i) => ({
        num: i + 1,
        id: m?.id,
        score: m?.score,
        text: m?.metadata?.text || "",
        meta: {
          docId: m?.metadata?.docId,
          chunk: m?.metadata?.chunk,
          title: m?.metadata?.title,
          url: m?.metadata?.url,
        },
      }))
      .filter((s) => s.text);

    // Re-rank
    const before = sources.length;
    sources = await rerank(query, sources, rid);
    sources = sources.map((s, i) => ({ ...s, num: i + 1 }));
    console.log(`[QRY  ${rid}] Rerank in/out=${before}→${sources.length}`);

    if (sources.length === 0) {
      const ms = Date.now() - started;

      // Check document existence for no document provided case
      let totalVectors = 0;
      try {
        const stats = await index.describeIndexStats();
        totalVectors = Object.values(stats?.namespaces || {}).reduce(
          (sum, ns) => sum + (ns?.vectorCount ?? ns?.recordCount ?? 0),
          0
        );
      } catch (err) {
        console.warn(`[QRY  ${rid}] Failed to check index stats`, err.message);
      }

      const answer =
        totalVectors === 0
          ? "no documents provided"
          : "I couldn't find an answer in the provided documents.";

      console.log(
        `[QRY  ${rid}] No sources found. totalVectors=${totalVectors} durationMs=${ms}`
      );

      // Query cost estimate
      const embCost = estimateEmbeddingCost(query.length);
      return res.json({
        answer,
        citations: [],
        sources: [],
        durationMs: ms,
        usage: null,
        costEstimate: {
          generation: { inTok: 0, outTok: 0, inCost: 0, outCost: 0, total: 0 },
          embedding: embCost,
          totalUsd: embCost.cost,
        },
      });
    }

    // Gemini Default prompt to adhere to expected structure
    const system = `
You are a careful assistant. Answer ONLY using the numbered SOURCES provided.
Every factual sentence MUST include citation markers like [1] or [1][3].
If the sources don't contain the answer, say so.
Return STRICT JSON with this exact shape:
{
  "answer": "final prose with [n] markers inline",
  "citations": [
    { "span": "short clause or sentence quoted/paraphrased", "sources": [1,2] }
  ]
}
No extra keys. No markdown fences. No commentary.
`.trim();

    const user = `
QUESTION:
${query}

SOURCES:
${sources.map((s) => `[${s.num}] ${s.text}`).join("\n\n")}
`.trim();

    const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const tLLM = Date.now();
    let parsed = null;
    let raw = "";
    let usage = null;
    try {
      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
        {
          contents: [
            { role: "model", parts: [{ text: system }] },
            { role: "user", parts: [{ text: user }] },
          ],
        },
        { timeout: 25000 }
      );
      raw = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      parsed = parseModelJson(raw);
      usage = geminiRes.data?.usageMetadata || null;

      console.log(
        `[LLM  ${rid}] model=${MODEL} parsed=${!!parsed} durationMs=${
          Date.now() - tLLM
        } tokens: in=${usage?.promptTokenCount ?? "?"} out=${
          usage?.candidatesTokenCount ?? "?"
        } total=${usage?.totalTokenCount ?? "?"}`
      );
    } catch (err) {
      console.error(`[LLM  ${rid}] FAILED`, err?.response?.data || err.message);
    }

    const answer =
      parsed?.answer?.trim() ||
      (raw && raw.trim().startsWith("{")
        ? "[Parsing error] Please retry."
        : "I couldn't format a reliable answer from the sources.");

    const citations = Array.isArray(parsed?.citations)
      ? parsed.citations.filter((c) => Array.isArray(c.sources))
      : [];

    // Cost estimates (generation + query embedding)
    const genCost = estimateGeminiCost(usage);
    const embCost = estimateEmbeddingCost(query.length);
    const costEstimate = {
      generation: genCost,
      embedding: embCost,
      totalUsd: dollars((genCost.total || 0) + (embCost.cost || 0)),
    };

    const durationMs = Date.now() - started;
    console.log(
      `[QRY  ${rid}] DONE answerChars=${(answer || "").length} sourcesUsed=${sources.length} durationMs=${durationMs} ` +
        `cost≈$${costEstimate.totalUsd} (gen:$${genCost.total} emb:$${embCost.cost})`
    );

    res.json({
      answer,
      citations,
      sources,
      durationMs,
      usage,
      costEstimate,
    });
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e.message || "Query failed";
    console.error(`[QRY  ${rid}] ERROR`, msg);
    res.status(500).json({ error: msg });
  }
});

// Process Log handlers
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
});

// Run server on given port
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mini RAG running on port ${PORT}`);
});
