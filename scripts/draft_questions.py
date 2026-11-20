"""
Draft benchmark questions for YOUR OWN documents, using Gemini, so you only have to review them.

Setup
    1. Copy your documents (pdf, docx, txt, md) into  data/benchmark_docs/
    2. From the project root:   backend\\venv\\Scripts\\python.exe scripts\\draft_questions.py --chunks 40
    3. Open data/own_questions.json and REVIEW every question. Delete or set "status": "rejected" on bad ones.
       Then run:  backend\\venv\\Scripts\\python.exe scripts\\benchmark.py --dataset own

How it works
    * Random chunks are sampled from your documents (same chunker the app uses).
    * For each chunk Gemini writes questions that this passage answers, each with the answer and a sentence
      copied word for word from the passage (the "evidence").
    * The script keeps a question only if the evidence really appears in the chunk. The benchmark later counts a
      retrieval as correct when a retrieved chunk contains that evidence sentence.
    * One question per chunk is asked as a paraphrase (different words than the passage), which is what shows
      the benefit of dense retrieval over keyword search.

Be upfront in your report: these questions are model-drafted and then reviewed by the team.
Existing questions in data/own_questions.json are kept; new ones are appended.
"""
import argparse
import json
import os
import random
import re
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(ROOT, "backend", ".env"))
except ImportError:
    pass

from chunking import chunk_text, extract_text  # noqa: E402

DOCS_DIR = os.path.join(ROOT, "data", "benchmark_docs")
OUT = os.path.join(ROOT, "data", "own_questions.json")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

PROMPT = """You write test questions for a document question-answering system.

Read the passage and write {n} questions that this passage answers on its own.
Rules:
- Each question must make sense WITHOUT seeing the passage (name the subject; never say "the passage" or "this text").
- Question 1 must be a PARAPHRASE: use different words than the passage uses for the key terms.
- The other question(s) may reuse the passage's own wording.
- For every question give a short answer and an "evidence" sentence copied EXACTLY, character for character, from the passage.
- Skip trivia (page numbers, headers). If the passage has no real content, return [].

Return ONLY a JSON list like:
[{{"question": "...", "answer": "...", "evidence": "..."}}]

PASSAGE:
\"\"\"{text}\"\"\"
"""


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def parse_drafts(response_text: str, chunk: str):
    """Parse the model's JSON and keep only questions whose evidence is verbatim in the chunk."""
    m = re.search(r"\[.*\]", response_text or "", re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    kept = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        q, a, ev = (it.get("question") or "").strip(), (it.get("answer") or "").strip(), (it.get("evidence") or "").strip()
        if len(q) < 10 or len(ev) < 20 or norm(ev) not in norm(chunk):
            continue
        kept.append({"question": q, "answer": a, "evidence": [ev]})
    return kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunks", type=int, default=40, help="how many chunks to sample (default 40)")
    ap.add_argument("--per-chunk", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    if not os.getenv("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY is not set (put it in backend/.env).")
    if not os.path.isdir(DOCS_DIR):
        sys.exit(f"Create the folder {DOCS_DIR} and copy your documents into it first.")

    pool = []
    for name in sorted(os.listdir(DOCS_DIR)):
        path = os.path.join(DOCS_DIR, name)
        if not os.path.isfile(path) or name.startswith("."):
            continue
        try:
            with open(path, "rb") as f:
                text = extract_text(name, f.read())
        except Exception as e:
            print(f"skipping {name}: {e}")
            continue
        for c in chunk_text(text, target_token_size=600, overlap_tokens=100):
            if len(c["text"]) > 300:
                pool.append((name, c["text"]))
    if not pool:
        sys.exit("No usable text found in the documents.")
    random.Random(args.seed).shuffle(pool)
    sample = pool[: args.chunks]
    print(f"{len(pool)} chunks available, sampling {len(sample)}; model {MODEL}")

    from google import genai
    from google.genai import types
    client = genai.Client(http_options=types.HttpOptions(timeout=90000))

    existing = {"name": "Own documents", "questions": []}
    if os.path.exists(OUT):
        with open(OUT, "r", encoding="utf-8") as f:
            existing = json.load(f)
    have = {norm(q["question"]) for q in existing.get("questions", [])}

    added = 0
    for i, (name, chunk) in enumerate(sample, start=1):
        try:
            resp = client.models.generate_content(
                model=MODEL, contents=PROMPT.format(n=args.per_chunk, text=chunk[:3500]))
            drafts = parse_drafts(resp.text, chunk)
        except Exception as e:
            print(f"  chunk {i}: Gemini error: {str(e)[:120]}")
            time.sleep(3)
            continue
        for d in drafts:
            if norm(d["question"]) in have:
                continue
            have.add(norm(d["question"]))
            d.update({"source": name, "type": "factual", "status": "draft"})
            existing["questions"].append(d)
            added += 1
        print(f"  chunk {i}/{len(sample)} ({name}): +{len(drafts)}", end="\r")
    print()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    print(f"Added {added} draft questions -> {OUT}  (total {len(existing['questions'])}). Review them before benchmarking.")


if __name__ == "__main__":
    main()