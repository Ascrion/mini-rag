# Mini-RAG (Track B) — README

### Live URLs
- **Website:** https://mini-rag-frontend.onrender.com  
    - (first initialization needs 15 seconds to cold start the backend)
- **Github:** https://github.com/Ascrion/mini-rag.git
- **Resume:** [G-Drive Link](https://drive.google.com/file/d/1z1Cym6jNNaoXG-yy4wx9A50EMKwxGym7/view?usp=sharing)

### Introduction
**mini-rag:** A Gemini + Pinecone + Cohere based Retreival-Augmented Generation pipeline that:
    - Retrieves relevant information from your uploaded documents.
    - Augments the query with those docs.
    - Generates an answer grounded in real sources, with inline citations.
    - Documents are split into ~1,000-token chunks with 15% overlap (~150 tokens)
    - Shows reponse timing, token usage and cost estimates.

### Architecture and Tech Stack
1. Node + Express (Backend)
    - Runs API Server
    - Route Handling (/upsert, /query, /reset, /health)
    - Connects the frontend to external AI services (Gemini, Cohere, Pinecone)
    - Adds rate limiting(30 requests per min per user), CORS, logging and error handling.
2. React (Frontend)
    - User Interface to communicate with backend
    - Allows document text insertion and querying
    - Displays answers + citations.
    - Displays Response Timing, Token Usage and Cost estimates.
3. Gemini (LLM and embedding)
    - Embeddings (embedding-001) converts text chunks into 768-dimensional vectors for semantic search.
    - LLM(gemini-1.5-flash) produces the NLP answer, with inline [1], [2].
4. Pinecone (Vector Database)
    - Stores embeddings (vector representations of your docs).
    - Retrieves the most similar chunks for a given query (semantic search) (topK:8)
5. Cohere (Rerank API)
    - Takes the retrieved chunks and re-orders them by relevance to the query.
    - Ensures the top docs passed to Gemini are the most useful.
    - Improves precision and reduces hallucination risk.

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
┌──▼──-┐    ┌─────▼─────┐    ┌─────▼─────┐
│Gemini│    │  Pinecone │    │  Cohere   │
│Embed │    │  VectorDB │    │  Rerank   │
└──┬───┘    └─────┬─────┘    └─────┬─────┘
   │        ┌─────▼─────┐          │
   └───────►│Gemini LLM │◄─────────┘
            │ 1.5-Flash │
            └─────┬─────┘
                  │
                  ▼
              Final Answer

### Pinecone Index Config
- Index name: Fetched from PINECONE_INDEX in .env
- Dimension: 768 
- Metric: cosine
- Namespace: "default"
- Deployment: Serverless, AWS us-east-1
- Metadata per vector:
{
  "text": "<chunk text>",
  "docId": "<original doc id>",
  "chunk": <number>,
  "title": "<optional>",
  "url": "<optional>",
  "source": "<optional>",
  "section": "<optional>",
  "position": "<optional>"
}

### Golden Q/A Pairs 
**Test Document Text:** 
    Mini-RAG Project Documentation

    Overview:  
    Mini-RAG is a retrieval-augmented generation system built with Gemini, Pinecone, and Cohere. It retrieves relevant document chunks, reranks them, and generates answers with inline citations.  

    Architecture:  
    1. Backend: Node.js + Express server, connects to AI services and handles routes.  
    2. Frontend: React app for uploading text, querying, and displaying answers.  
    3. Embeddings: Gemini embedding-001 (768-dim).  
    4. Vector Database: Pinecone, cosine similarity search, serverless deployment in AWS us-east-1.  
    5. Reranker: Cohere Rerank API, reorders retrieved chunks by relevance.  
    6. LLM: Gemini-1.5-Flash for generating answers with citations.  

    Chunking Strategy:  
    Documents are split into ~1,000-token chunks with ~10% overlap. Metadata includes text, docId, chunk, title, section, and position for traceability.  

    Hosting:  
    The project is deployed on Render (free tier). Cold starts may take ~15 seconds.  

    Future Improvements:  
    - Migrate to Cohere production API.  
    - Separate databases per user namespace.  
    - Upgrade hosting to ensure 24/7 uptime.  

**Questions:**

1. 

### Setup Process

1. Clone the repository
    `
    git clone https://github.com/Ascrion/mini-rag.git
    cd mini-rag
    `

2. Backend Setup 
    - Enter your API keys to the .env file
    - Runs at http://localhost:4000 by default
    `
    npm install
    cp .env.example .env 
    node server.js
    ` 
3. Frontend setup 
    - Runs at http://localhost:3000 by default
    `
    cd frontend
    npm install 
    npm start 
    `
4. Usage 
    - Open frontend in your browser
    - Insert document text in Add Documents section
    - Enter a question in the query box
    - Wait for the server response 
    - See the answer with inline citations [1], [2] in answer section.

### Remarks:
    - This project implements a basic production ready RAG Pipeline.
    - Documents are split into 1,000-token chunks to keep embedding costs low while maintaining enough context window
    - 150 token overlap reduces risk of losing information at chunk boundaries. 
    - Due to the small influx of requests, no rate-limits were breached
    - Future Improvements:
        - Move to Cohere Production API from trial API as it is the most rate-limited section of the pipleline.
        - Separate Databases for stoing namespaces per user.
        - Move to paid render plans / serverless functions to ensure 24*7 uptime
        - Enter documents such as PDFs inplace of just plain text.

### Attribution:
All external tools and APIs were used via their official SDKs and documentation.
- https://ai.google.dev/?utm_source=chatgpt.com
- https://www.pinecone.io/?utm_source=chatgpt.com
- https://cohere.com/?utm_source=chatgpt.com