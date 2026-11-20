#!/usr/bin/env bash
# Quickstart script for AdaptiRAG backend
set -e

echo "=== Starting AdaptiRAG Backend ==="
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "[*] Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "[*] Activating virtual environment..."
source venv/bin/activate

echo "[*] Installing dependencies..."
pip install -r requirements.txt

echo "[✓] Starting FastAPI server on http://localhost:8000 ..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
