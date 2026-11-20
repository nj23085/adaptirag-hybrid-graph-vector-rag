"""
AdaptiRAG Learned Router Model

A small text classifier that decides which retrieval engine should answer a question:

    local   -> a specific fact (dense / hybrid vector search)
    global  -> a broad, thematic, summary or comparison question (knowledge graph)
    hybrid  -> a question that links specific entities or needs several connected facts

The model is a multinomial logistic regression (softmax) over
  * TF-IDF weighted word unigrams and bigrams, and
  * a few structural features (length, capitalised words, digits, commas).

It is trained by scripts/train_router.py and stored in backend/router_model.json.
Inference needs only numpy, so there is no extra dependency and no API call.

The feature code lives here and is imported by the training script, so training and
prediction always use exactly the same features.
"""
import json
import math
import os
import re
from typing import Dict, List, Optional, Tuple

import numpy as np

MODEL_PATH = os.path.join(os.path.dirname(__file__), "router_model.json")

_WORD_RE = re.compile(r"[a-z0-9]+(?:['\-][a-z0-9]+)*")
NUM_STRUCT_FEATURES = 4  # see structural_features()


def tokenize(query: str) -> List[str]:
    return _WORD_RE.findall((query or "").lower())


def ngrams(tokens: List[str]) -> List[str]:
    """Unigrams plus bigrams (bigrams are joined with a space)."""
    return tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]


def structural_features(query: str) -> List[float]:
    """Cheap shape-of-the-question signals that are not tied to any vocabulary."""
    words = (query or "").split()
    n_words = len(words)
    # Capitalised words that are not the first word: a rough count of names / acronyms
    n_caps = sum(1 for w in words[1:] if w[:1].isupper())
    n_digits = sum(1 for w in words if any(ch.isdigit() for ch in w))
    n_commas = (query or "").count(",")
    return [math.log1p(n_words), float(n_caps), float(n_digits), float(n_commas)]


def tfidf_vector(query: str, vocab: Dict[str, int], idf: np.ndarray) -> np.ndarray:
    """L2-normalised, sublinear-tf TF-IDF vector over the vocabulary."""
    vec = np.zeros(len(vocab), dtype=np.float64)
    counts: Dict[str, int] = {}
    for term in ngrams(tokenize(query)):
        if term in vocab:
            counts[term] = counts.get(term, 0) + 1
    for term, c in counts.items():
        j = vocab[term]
        vec[j] = (1.0 + math.log(c)) * idf[j]
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def build_features(query: str, vocab: Dict[str, int], idf: np.ndarray,
                   struct_mean: np.ndarray, struct_std: np.ndarray) -> np.ndarray:
    struct = (np.array(structural_features(query)) - struct_mean) / struct_std
    return np.concatenate([tfidf_vector(query, vocab, idf), struct])


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


class LearnedRouter:
    """Loads backend/router_model.json and predicts the route of a query."""

    def __init__(self, path: Optional[str] = None):
        self.path = path or MODEL_PATH
        self.available = False
        self.meta: Dict = {}
        self._load()

    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                m = json.load(f)
            self.classes: List[str] = m["classes"]
            self.vocab: Dict[str, int] = m["vocab"]
            self.idf = np.array(m["idf"], dtype=np.float64)
            self.struct_mean = np.array(m["struct_mean"], dtype=np.float64)
            self.struct_std = np.array(m["struct_std"], dtype=np.float64)
            self.W = np.array(m["weights"], dtype=np.float64)   # (n_features, n_classes)
            self.b = np.array(m["bias"], dtype=np.float64)      # (n_classes,)
            self.meta = m.get("meta", {})
            self.available = True
        except (OSError, KeyError, ValueError) as e:
            print(f"[LearnedRouter] No usable model at {self.path} ({e}). Falling back to keyword router.")
            self.available = False

    def predict_proba(self, query: str) -> Dict[str, float]:
        x = build_features(query, self.vocab, self.idf, self.struct_mean, self.struct_std)
        p = softmax(x @ self.W + self.b)
        return {c: float(p[i]) for i, c in enumerate(self.classes)}

    def predict(self, query: str) -> Tuple[str, float, Dict[str, float]]:
        """Returns (route, confidence, class_probabilities)."""
        probs = self.predict_proba(query)
        route = max(probs, key=probs.get)
        return route, probs[route], probs

    def top_terms(self, query: str, top_n: int = 3) -> List[str]:
        """Terms of this query that pushed the prediction toward its chosen class (for explanations)."""
        route, _, _ = self.predict(query)
        ci = self.classes.index(route)
        tokens = set(ngrams(tokenize(query)))
        scored = []
        for term in tokens:
            j = self.vocab.get(term)
            if j is not None:
                scored.append((self.W[j, ci] * self.idf[j], term))
        scored.sort(reverse=True)
        return [t for s, t in scored[:top_n] if s > 0]