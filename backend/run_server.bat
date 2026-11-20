@echo off
REM Quickstart script for AdaptiRAG backend on Windows
echo === Starting AdaptiRAG Backend ===
cd /d "%~dp0"

if not exist "venv" (
    echo [*] Creating Python virtual environment...
    python -m venv venv
)

echo [*] Activating virtual environment...
call venv\Scripts\activate.bat

echo [*] Installing dependencies...
pip install -r requirements.txt

echo [✓] Starting FastAPI server on http://localhost:8000 ...
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
