import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { Pinecone } from "@pinecone-database/pinecone";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// === Rate limiting: 30 requests per minute per IP ===
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});
app.use(limiter);

// ====== Pinecone v2 (serverless) ======
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY, // no environment in v2
});
const index = pc.index(process.env.PINECONE_INDEX);

// ====== Helpers ======

// Chunk long text with overlap
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

// Gemini embeddings (embedding-001 + embedContent)
async function embedText(text) {
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`,
      { content: { parts: [{ text }] } },
      { timeout: 15000 }
    );
    const vec = res.data?.embedding?.values;
    if (!Array.isArray(vec)) throw new Error("Bad embedding shape from Gemini");
    return vec; // float[]
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e.message;
    console.error("embedText error:", msg);
    throw new Error("Embedding failed: " + msg);
  }
}

// Optional: Cohere reranker
async function rerank(query, documents) {
  if (!process.env.COHERE_API_KEY) return documents;
  try {
    const res = await axios.post(
      "https://api.cohere.ai/v1/rerank",
      {
        query,
        documents: documents.map((d, i) => ({ id: String(i), text: d }))
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );
    const results = res.data?.results || [];
    // results contain {index, relevance_score}
    const byScoreDesc = [...results].sort(
      (a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    );
    return byScoreDesc.map(r => documents[r.index]).filter(Boolean);
  } catch (err) {
    console.warn("Rerank failed, fallback to Pinecone order:", err.message);
    return documents;
  }
}

// ====== Routes ======

// Simple root + health routes so you can see the server is alive
app.get("/", (_req, res) => {
  res.send("Mini RAG server is alive ✅");
});

app.get("/pc/health", async (_req, res) => {
  try {
    const list = await pc.listIndexes();
    // v2 returns { indexes: [ ... ] }
    res.json({ indexes: list.indexes ?? list });
  } catch (e) {
    console.error("Pinecone health error:", e?.message);
    res.status(500).json({ error: e?.message });
  }
});

// Upsert documents (with chunking)
app.post("/upsert", async (req, res) => {
  try {
    const { docs } = req.body; // [{id, text}]
    if (!Array.isArray(docs) || docs.length === 0) {
      return res.status(400).json({ error: "Body should be { docs: [{id, text}, ...] }" });
    }

    const vectors = [];
    for (const doc of docs) {
      if (!doc?.id || !doc?.text) continue;
      const chunks = chunkText(doc.text);
      for (let i = 0; i < chunks.length; i++) {
        const values = await embedText(chunks[i]); // 768-dim
        vectors.push({
          id: `${doc.id}-${i}`,
          values,
          metadata: { text: chunks[i], docId: doc.id, chunk: i }
        });
      }
    }

    if (vectors.length === 0) {
      return res.status(400).json({ error: "No valid chunks to upsert" });
    }

    await index.upsert(vectors); // 👈 pass array
    res.json({ status: "upserted", count: vectors.length });
  } catch (e) {
    console.error("Upsert error:", e?.response?.data || e.message);
    res.status(500).json({ error: e?.message || "Upsert failed" });
  }
});


// Query -> retrieve -> rerank -> Gemini answer
app.post("/query", async (req, res) => {
  const startTime = Date.now();
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Body should be { query: string }" });
    }

    const queryEmbedding = await embedText(query);

    const search = await index.query({
      topK: 8,
      vector: queryEmbedding,
      includeMetadata: true
    });

    let contexts =
      (search?.matches || [])
        .map(m => m?.metadata?.text)
        .filter(Boolean);

    // Rerank with Cohere if available
    contexts = await rerank(query, contexts);

    const prompt = `
You are a helpful assistant. Use the following context to answer the user's question.
Cite sources inline like [1], [2]. If the answer is not in the context, say you don't know.

Context:
${contexts.map((c, i) => `[${i + 1}] ${c}`).join("\n")}

Question: ${query}
Answer:
`.trim();

    const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const geminiRes = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    { contents: [{ role: "user", parts: [{ text: prompt }] }] },
    { timeout: 20000 }
    );


    const answer =
      geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No answer.";

    const duration = Date.now() - startTime;
    res.json({ answer, contexts, duration });
  } catch (e) {
    const msg = e?.response?.data?.error?.message || e.message || "Query failed";
    console.error("Query error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Mini RAG running on port " + (process.env.PORT || 3000));
});
