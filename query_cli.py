#!/usr/bin/env python3
"""
AdaptiRAG Standalone CLI: Ingest documents and query the system directly from terminal.
Usage:
    python3 query_cli.py --ingest my_paper.pdf
    python3 query_cli.py --ask "What is the consensus algorithm in Phase 1?"
    python3 query_cli.py --ask "Compare all architectures" --mode global
"""

import sys
import os
import argparse
import json
import requests

API_BASE = os.environ.get("ADAPTIRAG_API_URL", "http://localhost:8000")

def ingest_file(file_path: str):
    if not os.path.exists(file_path):
        print(f"[Error] File '{file_path}' does not exist.")
        sys.exit(1)

    filename = os.path.basename(file_path)
    print(f"[*] Uploading and indexing '{filename}' to {API_BASE}/documents ...")
    
    with open(file_path, "rb") as f:
        files = {"file": (filename, f)}
        try:
            res = requests.post(f"{API_BASE}/documents", files=files)
            if res.status_code in [200, 201]:
                data = res.json()
                print(f"[✓] Successfully ingested '{filename}'!")
                print(f"    - Document ID: {data.get('id')}")
                print(f"    - Chunks Created: {data.get('chunk_count')}")
                print(f"    - File Size: {data.get('file_size')} bytes")
                print(f"    - Status: {data.get('status')}")
                print("[*] Both FAISS Vector Index and Knowledge Graph have been synchronized.")
            else:
                print(f"[Error] Ingestion failed ({res.status_code}): {res.text}")
        except Exception as e:
            print(f"[Connection Error] Ensure backend is running at {API_BASE} (cd backend && python3 -m uvicorn main:app --port 8000)")
            print(f"Details: {e}")

def ask_query(query: str, mode: str = "auto", top_k: int = 4):
    print(f"\n[*] Query: \"{query}\"")
    print(f"[*] Route Mode: {mode} (Top-K: {top_k})")
    print("[*] Executing adaptive routing...\n")

    try:
        res = requests.post(
            f"{API_BASE}/router/execute",
            json={"query": query, "mode": mode, "top_k": top_k},
            headers={"Content-Type": "application/json"}
        )
        if res.status_code == 200:
            data = res.json()
            route = data.get("route", "unknown").upper()
            latency = data.get("latency_ms", 0)
            tokens = data.get("tokens_used", 0)
            cost = data.get("cost_usd", 0.0)

            print("=" * 70)
            print(f"ROUTE CHOSEN: {route} | LATENCY: {latency}ms | TOKENS: {tokens} | COST: ${cost:.6f}")
            print("=" * 70)
            print(f"\n{data.get('answer', '')}\n")

            citations = data.get("citations", [])
            if citations:
                print("-" * 70)
                print(f"GROUNDED CITATIONS ({len(citations)}):")
                for idx, c in enumerate(citations[:5], 1):
                    fn = c.get("filename", "Doc")
                    ci = c.get("chunk_index", 0)
                    score = c.get("score", 0.0)
                    snippet = c.get("text", "")[:120].replace("\n", " ")
                    print(f"  [{idx}] [{fn}, Chunk: {ci}] (score: {score:.3f}): \"{snippet}...\"")
            print("=" * 70)
        else:
            print(f"[Error] Query execution failed ({res.status_code}): {res.text}")
    except Exception as e:
        print(f"[Connection Error] Could not connect to {API_BASE}.")
        print("Please start the backend: cd backend && python3 -m uvicorn main:app --port 8000")
        print(f"Details: {e}")

def list_documents():
    try:
        res = requests.get(f"{API_BASE}/documents")
        if res.status_code == 200:
            docs = res.json()
            print(f"\n[*] Total Indexed Documents: {len(docs)}")
            for d in docs:
                print(f"  - ID {d.get('id')}: {d.get('filename')} ({d.get('chunk_count')} chunks, {d.get('status')})")
        else:
            print(f"[Error] Failed to fetch documents: {res.text}")
    except Exception as e:
        print(f"[Connection Error] {e}")

def main():
    parser = argparse.ArgumentParser(description="AdaptiRAG Command Line Interface")
    parser.add_argument("--ingest", "-i", type=str, help="Path to document file to ingest (.pdf, .docx, .txt, .md)")
    parser.add_argument("--ask", "-a", type=str, help="Question to ask across indexed documents")
    parser.add_argument("--mode", "-m", type=str, default="auto", choices=["auto", "local", "global", "hybrid"], help="Routing mode")
    parser.add_argument("--top_k", "-k", type=int, default=4, help="Number of vector chunks to retrieve")
    parser.add_argument("--list-docs", "-l", action="store_true", help="List all ingested documents")

    args = parser.parse_args()

    if args.ingest:
        ingest_file(args.ingest)
    elif args.ask:
        ask_query(args.ask, mode=args.mode, top_k=args.top_k)
    elif args.list_docs:
        list_documents()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
