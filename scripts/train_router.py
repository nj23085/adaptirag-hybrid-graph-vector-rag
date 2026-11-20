"""
Train the AdaptiRAG learned router and evaluate it against the old keyword router.

Run from the project root:

    python scripts/train_router.py

Reads   data/router_labels.json      (train, held-out test, and a "hard_test" stress set; all with route labels)
Writes  backend/router_model.json    (the trained model used by the backend)
        data/router_eval.json        (measured accuracy, per-class scores, confusion matrices)

Honest evaluation: the lambda (regularisation) value is chosen by cross-validation on the TRAIN set
only. The TEST set is used exactly once, at the end, to report the final numbers.
"""
import datetime
import json
import math
import os
import random
import sys
from collections import Counter
from typing import Dict, List, Tuple

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import router_model as rm  # noqa: E402  (shared feature code: training and prediction use identical features)

DATA_PATH = os.path.join(ROOT, "data", "router_labels.json")
MODEL_OUT = os.path.join(ROOT, "backend", "router_model.json")
EVAL_OUT = os.path.join(ROOT, "data", "router_eval.json")
LAMBDAS = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]
MIN_DF = 2  # a term must appear in at least 2 training questions


# ------------------------------------------------------------------ fitting
def build_vocab(queries: List[str]) -> Tuple[Dict[str, int], np.ndarray]:
    df: Counter = Counter()
    for q in queries:
        df.update(set(rm.ngrams(rm.tokenize(q))))
    terms = sorted(t for t, c in df.items() if c >= MIN_DF)
    vocab = {t: i for i, t in enumerate(terms)}
    n = len(queries)
    idf = np.array([math.log((1 + n) / (1 + df[t])) + 1.0 for t in terms], dtype=np.float64)
    return vocab, idf


def fit(rows: List[dict], classes: List[str], lam: float, iters: int = 600, lr: float = 0.2) -> dict:
    queries = [r["query"] for r in rows]
    vocab, idf = build_vocab(queries)
    struct = np.array([rm.structural_features(q) for q in queries])
    mean, std = struct.mean(axis=0), struct.std(axis=0)
    std[std == 0] = 1.0
    X = np.stack([rm.build_features(q, vocab, idf, mean, std) for q in queries])
    y = np.array([classes.index(r["label"]) for r in rows])
    n, d = X.shape
    k = len(classes)
    Y = np.eye(k)[y]

    W = np.zeros((d, k))
    b = np.zeros(k)
    # Adam optimiser on the L2-regularised cross-entropy (full batch; the problem is tiny)
    mW, vW, mb, vb = np.zeros_like(W), np.zeros_like(W), np.zeros_like(b), np.zeros_like(b)
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    for t in range(1, iters + 1):
        P = rm.softmax(X @ W + b)
        gW = X.T @ (P - Y) / n + lam * W
        gb = (P - Y).mean(axis=0)
        mW = beta1 * mW + (1 - beta1) * gW
        vW = beta2 * vW + (1 - beta2) * gW ** 2
        mb = beta1 * mb + (1 - beta1) * gb
        vb = beta2 * vb + (1 - beta2) * gb ** 2
        W -= lr * (mW / (1 - beta1 ** t)) / (np.sqrt(vW / (1 - beta2 ** t)) + eps)
        b -= lr * (mb / (1 - beta1 ** t)) / (np.sqrt(vb / (1 - beta2 ** t)) + eps)
    return {"classes": classes, "vocab": vocab, "idf": idf, "struct_mean": mean, "struct_std": std, "W": W, "b": b}


def predict(model: dict, queries: List[str]) -> List[str]:
    out = []
    for q in queries:
        x = rm.build_features(q, model["vocab"], model["idf"], model["struct_mean"], model["struct_std"])
        out.append(model["classes"][int(np.argmax(x @ model["W"] + model["b"]))])
    return out


def accuracy(pred: List[str], truth: List[str]) -> float:
    return sum(p == t for p, t in zip(pred, truth)) / len(truth)


# ------------------------------------------------------------------ evaluation helpers
def confusion(pred: List[str], truth: List[str], classes: List[str]) -> Dict[str, Dict[str, int]]:
    return {t: {p: sum(1 for a, b in zip(truth, pred) if a == t and b == p) for p in classes} for t in classes}


def per_class(pred: List[str], truth: List[str], classes: List[str]) -> Dict[str, Dict[str, float]]:
    out = {}
    for c in classes:
        tp = sum(1 for p, t in zip(pred, truth) if p == c and t == c)
        fp = sum(1 for p, t in zip(pred, truth) if p == c and t != c)
        fn = sum(1 for p, t in zip(pred, truth) if p != c and t == c)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        out[c] = {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3), "support": tp + fn}
    return out


def bootstrap_ci(pred: List[str], truth: List[str], n_boot: int = 2000, seed: int = 0) -> Tuple[float, float]:
    rng = random.Random(seed)
    correct = [int(p == t) for p, t in zip(pred, truth)]
    n = len(correct)
    stats = sorted(sum(correct[rng.randrange(n)] for _ in range(n)) / n for _ in range(n_boot))
    return stats[int(0.025 * n_boot)], stats[int(0.975 * n_boot)]


def cross_validate(rows: List[dict], classes: List[str], lam: float, folds: int = 5, seed: int = 0) -> float:
    rng = random.Random(seed)
    idx = list(range(len(rows)))
    rng.shuffle(idx)
    accs = []
    for f in range(folds):
        val_idx = set(idx[f::folds])
        train_rows = [rows[i] for i in idx if i not in val_idx]
        val_rows = [rows[i] for i in idx if i in val_idx]
        model = fit(train_rows, classes, lam)
        accs.append(accuracy(predict(model, [r["query"] for r in val_rows]), [r["label"] for r in val_rows]))
    return float(np.mean(accs))


def keyword_baseline(queries: List[str]):
    """Predictions of the old rule-based router, if the backend can be imported."""
    try:
        from router import RouterAgent  # type: ignore
        agent = RouterAgent()
        return [agent.classify(q)["route"] for q in queries]
    except Exception as e:  # pragma: no cover
        print(f"(keyword baseline skipped: {e})")
        return None


# ------------------------------------------------------------------ main
def main() -> None:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    classes = data["labels"]
    train, test = data["train"], data["test"]
    train_q, test_q = [r["query"] for r in train], [r["query"] for r in test]
    train_y, test_y = [r["label"] for r in train], [r["label"] for r in test]
    hard = data.get("hard_test", [])
    hard_q, hard_y = [r["query"] for r in hard], [r["label"] for r in hard]
    seen = {q.lower() for q in train_q}
    assert not (seen & {q.lower() for q in test_q}), "train/test overlap"
    assert not (seen & {q.lower() for q in hard_q}), "train/hard_test overlap"

    print(f"Train: {len(train)} questions {dict(Counter(train_y))}")
    print(f"Test : {len(test)} questions {dict(Counter(test_y))}\n")

    print("Choosing lambda by 5-fold cross-validation on the TRAIN set only:")
    cv = {}
    for lam in LAMBDAS:
        cv[lam] = cross_validate(train, classes, lam)
        print(f"  lambda={lam:<6} cv accuracy {cv[lam]:.1%}")
    best_lam = max(LAMBDAS, key=lambda l: (cv[l], l))
    print(f"-> best lambda = {best_lam}\n")

    model = fit(train, classes, best_lam)
    test_pred = predict(model, test_q)
    train_pred = predict(model, train_q)
    test_acc, train_acc = accuracy(test_pred, test_y), accuracy(train_pred, train_y)
    lo, hi = bootstrap_ci(test_pred, test_y)
    print(f"LEARNED router  train accuracy {train_acc:.1%} | TEST accuracy {test_acc:.1%} (95% CI {lo:.1%} to {hi:.1%})")

    kw_pred = keyword_baseline(test_q)
    kw_acc = accuracy(kw_pred, test_y) if kw_pred else None
    if kw_acc is not None:
        print(f"KEYWORD router                      TEST accuracy {kw_acc:.1%}")

    hard_pred = predict(model, hard_q) if hard else []
    hard_acc = accuracy(hard_pred, hard_y) if hard else None
    kw_hard = keyword_baseline(hard_q) if hard else None
    if hard:
        kw_hard_acc = accuracy(kw_hard, hard_y) if kw_hard else None
        print(f"\nHARD stress set ({len(hard)} awkward questions, never trained on): "
              f"learned {hard_acc:.1%}" + (f" | keyword {kw_hard_acc:.1%}" if kw_hard_acc is not None else ""))
        for q, t, p in zip(hard_q, hard_y, hard_pred):
            if t != p:
                print(f"    wrong: {q[:70]!r}  true={t} predicted={p}")

    pc = per_class(test_pred, test_y, classes)
    print("\nPer-class on TEST (learned):")
    for c in classes:
        print(f"  {c:<7} precision {pc[c]['precision']:.2f}  recall {pc[c]['recall']:.2f}  f1 {pc[c]['f1']:.2f}  (n={pc[c]['support']})")
    cm = confusion(test_pred, test_y, classes)
    print("\nConfusion matrix on TEST (rows = true, columns = predicted):")
    print("          " + "  ".join(f"{c:>7}" for c in classes))
    for t in classes:
        print(f"  {t:<7} " + "  ".join(f"{cm[t][p]:>7}" for p in classes))

    # ---- save the model (plain JSON, loaded by backend/router_model.py)
    out = {
        "classes": classes,
        "vocab": model["vocab"],
        "idf": [round(float(v), 6) for v in model["idf"]],
        "struct_mean": [float(v) for v in model["struct_mean"]],
        "struct_std": [float(v) for v in model["struct_std"]],
        "weights": [[round(float(v), 6) for v in row] for row in model["W"]],
        "bias": [round(float(v), 6) for v in model["b"]],
        "meta": {
            "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "train_size": len(train), "test_size": len(test), "lambda": best_lam,
            "vocab_size": len(model["vocab"]),
            "test_accuracy": round(test_acc, 4),
            "hard_test_accuracy": round(hard_acc, 4) if hard_acc is not None else None,
        },
    }
    with open(MODEL_OUT, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"\nSaved model -> {os.path.relpath(MODEL_OUT, ROOT)} ({len(model['vocab'])} terms)")

    # ---- save the measured results (shown on the Efficiency page)
    report = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "train_size": len(train), "test_size": len(test), "lambda": best_lam,
        "learned": {"test_accuracy": round(test_acc, 4), "train_accuracy": round(train_acc, 4),
                    "ci95": [round(lo, 4), round(hi, 4)], "per_class": pc, "confusion": cm},
        "keyword": ({"test_accuracy": round(kw_acc, 4), "per_class": per_class(kw_pred, test_y, classes),
                     "confusion": confusion(kw_pred, test_y, classes)} if kw_pred else None),
        "hard_test": ({"size": len(hard), "learned_accuracy": round(hard_acc, 4),
                       "keyword_accuracy": (round(accuracy(kw_hard, hard_y), 4) if kw_hard else None),
                       "misclassified": [{"query": q, "true": t, "predicted": p}
                                         for q, t, p in zip(hard_q, hard_y, hard_pred) if t != p]} if hard else None),
        "cv_accuracy_by_lambda": {str(k): round(v, 4) for k, v in cv.items()},
        "misclassified": [{"query": q, "true": t, "predicted": p}
                          for q, t, p in zip(test_q, test_y, test_pred) if t != p],
    }
    with open(EVAL_OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print(f"Saved results -> {os.path.relpath(EVAL_OUT, ROOT)}")


if __name__ == "__main__":
    main()