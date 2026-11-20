"""
Build a benchmark subset from HotpotQA (a public multi-hop question answering dataset).

Run from the project root:

    python scripts/prepare_hotpotqa.py                 # downloads the official dev file (about 47 MB)
    python scripts/prepare_hotpotqa.py --n 300         # number of questions to sample (default 300)
    python scripts/prepare_hotpotqa.py --file C:\\path\\hotpot_dev_distractor_v1.json   # use a file you downloaded yourself
    python scripts/prepare_hotpotqa.py --hf            # download through Hugging Face instead (needs: pip install datasets)

Official download page: https://hotpotqa.github.io/   (file: "dev set, distractor setting")

Writes  data/hotpotqa_subset.json  in the format scripts/benchmark.py reads.

How the subset is built
    * N questions are sampled with a fixed random seed (so everyone gets the same questions).
    * Every question comes with 10 paragraphs (2 that hold the answer, 8 distractors). All paragraphs of all
      sampled questions are pooled into ONE shared corpus, so retrieval has to find the right 2 paragraphs
      among thousands, like a real knowledge base.
    * Gold evidence for a question = the titles of its supporting paragraphs. A question counts as fully
      answered by retrieval only if BOTH supporting paragraphs are retrieved ("all-gold").
"""
import argparse
import json
import os
import random
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "hotpotqa_subset.json")
URL = "http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json"


def load_hf():
    """Load HotpotQA (distractor, validation split) from Hugging Face and convert it to the original file layout."""
    try:
        from datasets import load_dataset
    except ImportError:
        sys.exit("Install it first:  backend\\venv\\Scripts\\python.exe -m pip install datasets")
    ds = load_dataset("hotpotqa/hotpot_qa", "distractor", split="validation")
    raw = []
    for row in ds:
        raw.append({
            "question": row["question"],
            "answer": row["answer"],
            "type": row.get("type", "other"),
            "level": row.get("level", ""),
            "context": [[t, list(sents)] for t, sents in zip(row["context"]["title"], row["context"]["sentences"])],
            "supporting_facts": [[t, int(i)] for t, i in zip(row["supporting_facts"]["title"], row["supporting_facts"]["sent_id"])],
        })
    return raw


def load_source(path: str, hf: bool = False):
    if hf:
        return load_hf()
    if path:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    print(f"Downloading {URL} ...")
    try:
        with urllib.request.urlopen(URL, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        sys.exit(f"Download failed ({e}).\nDownload 'dev set, distractor setting' from https://hotpotqa.github.io/ "
                 f"in your browser, then run:  python scripts/prepare_hotpotqa.py --file <downloaded file>\n"
                 f"or try:  python scripts/prepare_hotpotqa.py --hf   (needs: pip install datasets)")


def build_subset(raw, n: int, seed: int):
    rng = random.Random(seed)
    items = list(raw)
    rng.shuffle(items)
    items = items[:n]

    documents, seen = [], set()
    questions = []
    for it in items:
        # context = [[title, [sentence, ...]], ...]
        for title, sentences in it["context"]:
            if title in seen:
                continue
            seen.add(title)
            documents.append({"doc_id": title, "title": title, "text": f"{title}\n" + " ".join(s.strip() for s in sentences)})
        gold_titles = []
        for title, _sent_id in it["supporting_facts"]:
            if title not in gold_titles:
                gold_titles.append(title)
        questions.append({
            "question": it["question"],
            "answer": it.get("answer", ""),
            "gold": [{"doc": t} for t in gold_titles],
            "type": it.get("type", "other"),
            "level": it.get("level", ""),
        })
    return {
        "name": f"HotpotQA distractor ({len(questions)} questions)",
        "kind": "public",
        "source": "HotpotQA dev set, distractor setting (Yang et al., 2018)",
        "seed": seed,
        "documents": documents,
        "questions": questions,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--file", help="path to hotpot_dev_distractor_v1.json if you downloaded it yourself")
    ap.add_argument("--hf", action="store_true", help="download through Hugging Face (pip install datasets)")
    args = ap.parse_args()
    data = build_subset(load_source(args.file, args.hf), args.n, args.seed)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f)
    types = {}
    for q in data["questions"]:
        types[q["type"]] = types.get(q["type"], 0) + 1
    print(f"Wrote {OUT}: {len(data['questions'])} questions, {len(data['documents'])} paragraphs, types {types}")


if __name__ == "__main__":
    main()