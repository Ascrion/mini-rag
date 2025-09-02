# 📑 Mini-RAG Project Report

## ✅ Current Status
- End-to-end **Retrieval-Augmented Generation (RAG)** pipeline is working:
  1. **Documents** are chunked and embedded with **Gemini `embedding-001`** (768-dim).
  2. **Embeddings** are stored and retrieved from a **Pinecone** index (`mini-rag`, 768-dim, cosine metric).
  3. **Cohere** reranks retrieved chunks for relevance.
  4. **Gemini 1.5 Flash** generates grounded answers, with inline citations `[1]`, `[2]`.
  5. The system responds to questions in ~8s end-to-end.

You confirmed:
- `/upsert` works → documents stored in Pinecone.  
- `/query` works → retrieves, reranks, answers with citations.  

---

## 🛠️ Technologies Used

### Backend
- **Node.js (v22)** — runtime.  
- **Express.js** — REST API server.  
- **Axios** — HTTP requests to Gemini + Cohere.  
- **dotenv** — environment variable management.  
- **body-parser** — parsing JSON request bodies.  
- **cors** — enable cross-origin requests (for frontend).  
- **express-rate-limit** — request throttling (30 req/min per IP).  

### RAG Components
- **Google Gemini**  
  - `embedding-001:embedContent` → 768-dim text embeddings.  
  - `gemini-1.5-flash:generateContent` → answer generation.  
- **Pinecone Vector Database**  
  - Index: `mini-rag`  
  - Config: `dimension=768`, `metric=cosine`, serverless, AWS us-east-1.  
  - Used for similarity search (semantic retrieval).  
- **Cohere API**  
  - Endpoint: `/v1/rerank`  
  - Reranks retrieved Pinecone contexts by query relevance.  

### Frontend
- **React.js** (create-react-app scaffold).  
- Dev server proxied to backend (`"proxy": "http://localhost:4000"`).  
- Frontend communicates with backend endpoints:  
  - `POST /upsert`  
  - `POST /query`  

---
## Key Features 
- Chunking with overlap → preserves context.
- Embeddings + Pinecone → scalable semantic retrieval.
- Reranking with Cohere → improves precision of retrieved docs.
- Answer grounding → citations inline [1], [2].
- Rate limiting → safe from abuse (30 req/min).
- Cross-origin safe → frontend can call backend easily.

          ┌─────────────┐
          │   Frontend  │  (React UI)
          └──────┬──────┘
                 │
        HTTP (CORS, JSON)
                 │
          ┌──────▼──────┐
          │   Backend   │  (Express.js)
          │  server.js  │
          └──────┬──────┘
   ┌─────────────┼─────────────────┐
   │             │                 │
   │             │                 │
┌──▼──┐    ┌─────▼─────┐    ┌─────▼─────┐
│Gemini│    │  Pinecone │    │  Cohere   │
│Embed │    │  VectorDB │    │  Rerank   │
└──┬───┘    └─────┬─────┘    └─────┬─────┘
   │              │                │
   │              │                │
   │        ┌─────▼─────┐          │
   └───────►│Gemini LLM │◄─────────┘
            │ 1.5-Flash │
            └─────┬─────┘
                  │
                  ▼
              Final Answer
              (with citations)

## API Endpoints
API Endpoints
POST /upsert



## 📦 Libraries Installed
```json
"dependencies": {
  "express": "...",
  "body-parser": "...",
  "cors": "...",
  "dotenv": "...",
  "axios": "...",
  "express-rate-limit": "...",
  "@pinecone-database/pinecone": "latest",
  "react": "...",
  "react-dom": "...",
  "react-scripts": "..."
}

### 