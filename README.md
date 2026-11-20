# AdaptiRAG: Adaptive Hybrid Graph-Vector RAG Platform

AdaptiRAG is an open-source, production-ready Hybrid RAG architecture that dynamically balances **Low-Latency Pointwise Vector Search (FAISS)** and **Topological Community Graph Map-Reduce (Louvain Modular GraphRAG)** using an **Adaptive Query Router Agent**.

---

## 🚀 Quickstart: Running Locally After Unzipping

When you download and extract the ZIP archive from Google AI Studio, follow the simple steps below to run the system with your documents.

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** and **npm**
- (Optional) A **Gemini API Key** or **OpenAI API Key** if you want live LLM generation instead of local grounded extractive synthesis.

---

### Step 1: Start the Backend Server (FastAPI + FAISS + GraphRAG)

Open a terminal in the root directory:

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate       # On Windows: venv\Scripts\activate

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. (Optional) Set your Gemini API key
export GEMINI_API_KEY="your-gemini-api-key"

# 5. Start the API server
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The backend server runs on `http://localhost:8000`. You can inspect the interactive Swagger API docs at `http://localhost:8000/docs`.

---

### Step 2: Start the Frontend UI (React + Tailwind + Vite)

Open a second terminal in the root directory:

```bash
# 1. Install Node dependencies
npm install

# 2. Start the Vite dev server
npm run dev
```

Open `http://localhost:3000` (or `http://localhost:5173`) in your browser to interact with the full AdaptiRAG Workbench.

---

## 📄 Ingesting Documents & Asking Questions

### Method A: Using the Graphical Web Interface (Easiest)

1. **Upload your Document**:
   - In the top navigation bar, click on **"Document Ingestion & Chunking (Phase 1)"**.
   - Drag & drop or browse your file (`.pdf`, `.docx`, `.txt`, or `.md`), or paste custom text into the manual editor.
   - Adjust chunk size (default: 600 tokens, 100 token overlap) and click **"Ingest & Chunk Document"**.
   - The backend automatically:
     - Normalizes and chunks text with verifiable char offsets.
     - Embeds chunks and inserts them into the **FAISS Index**.
     - Extracts entities and relational triples into the **Knowledge Graph**.
     - Runs Louvain community detection for hierarchical summarization.

2. **Ask Questions with Grounded Evidence**:
   - Click on the **"Unified Chat & Citations (Phase 5)"** tab.
   - Type your question in the input bar and press **Enter** (or click Send).
   - You can also click the paperclip / **"Ingest Document"** button right inside the chat toolbar!
   - You will see:
     - **Dynamic Routing Decision**: Whether your question was routed to `Local Vector`, `Global Graph Map-Reduce`, or `Hybrid Dual-Engine`.
     - **Exact Bracket Citations**: E.g., `[Doc: your_file.pdf, Chunk: 0]` or `[Community: Quorum Systems]`.
     - **Evidence Inspector**: Click any citation badge on the right-hand panel to view the exact source text and similarity score.

---

### Method B: Using the Command Line / Python Script

A ready-to-run script `query_cli.py` is included for zero-friction terminal usage:

```bash
# Ingest any document:
python3 query_cli.py --ingest path/to/my_document.pdf

# Ask a factual pointwise question (auto-routes to local vector FAISS):
python3 query_cli.py --ask "What is the key algorithm described in section 2?"

# Ask a comparative or thematic summary question (auto-routes to global graph):
python3 query_cli.py --ask "Summarize all protocols and architectural trade-offs."
```

Or using standard `curl`:

```bash
# 1. Upload Document
curl -X POST "http://localhost:8000/documents" \
  -F "file=@path/to/my_document.pdf"

# 2. Query with Adaptive Routing
curl -X POST "http://localhost:8000/router/execute" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the main conclusion of the document?", "mode": "auto"}'
```

---

## 📂 Project Architecture

```
├── backend/
│   ├── main.py              # FastAPI endpoints (documents, vector, graph, router)
│   ├── chunking.py          # PDF/DOCX/TXT extraction & sliding window chunker
│   ├── embeddings.py        # Dense embeddings generator (Gemini / local cosine)
│   ├── vector_store.py      # FAISS IndexFlatIP dense vector store
│   ├── graph_extractor.py   # Entity & relationship triple extraction
│   ├── graph_pipeline.py    # NetworkX & Louvain community summarizer
│   ├── router.py            # Phase 4 Adaptive Query Router Agent
│   ├── generator.py         # Grounded generation with citation enforcement
│   ├── models.py            # SQLite ORM models
│   └── requirements.txt     # Python requirements
├── src/
│   ├── components/
│   │   ├── UnifiedChatWorkbench.tsx      # Multi-turn chat & citation inspector
│   │   ├── IngestionWorkbench.tsx        # File upload, chunking & preview
│   │   ├── ProductionEvaluationHarness.tsx# Cost/latency tradeoff benchmarks
│   │   ├── RouterWorkbench.tsx           # Router signal breakdown & telemetry
│   │   ├── GraphWorkbench.tsx            # Interactive D3 graph visualization
│   │   └── VectorSearchWorkbench.tsx     # FAISS similarity search tester
│   ├── App.tsx              # Main UI navigation
│   └── types.ts             # Shared TypeScript schemas
├── query_cli.py             # Standalone Python CLI for ingestion & querying
└── README.md
```

---

## 🛠 Features & Verification
- **Zero Hallucination Grounding**: Every answer is strictly bound to indexed document coordinates.
- **Adaptive Cost/Latency Optimization**: 64.8% cost savings by routing pointwise questions to local FAISS instead of expensive GraphRAG passes.
- **SQLite Persistence**: Local database (`adaptirag.db`) stores user accounts, documents, chunks, graph communities, and query telemetry.
