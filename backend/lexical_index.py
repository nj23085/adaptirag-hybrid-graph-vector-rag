"""
AdaptiRAG Lexical Index (BM25)

A small, dependency-free BM25 keyword index. It complements dense (FAISS) search:
dense vectors capture meaning, BM25 captures exact terms such as names, acronyms,
numbers and rare words that embeddings often blur together.

BM25 score of a document D for a query Q:

    score(D, Q) = sum over query terms t of
                  IDF(t) * tf(t, D) * (k1 + 1) / ( tf(t, D) + k1 * (1 - b + b * |D| / avgdl) )

    IDF(t) = ln( 1 + (N - df(t) + 0.5) / (df(t) + 0.5) )
"""
import math
import re
from collections import Counter
from typing import Dict, List, Tuple

# Keeps words, numbers and simple compounds like "state-machine" or "gpt-4o"
_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[-_'][a-z0-9]+)*")

# Very common words carry no ranking signal for keyword search
STOPWORDS = frozenset("""
a an and are as at be but by for from has have he her his how i if in into is it its of on or
our she so than that the their them then there these they this to was we were what when where
which who why will with you your do does did can could should would about over under between
""".split())


def tokenize(text: str) -> List[str]:
    """Lowercase, split into word tokens, drop stopwords and 1-character tokens."""
    tokens = _TOKEN_RE.findall((text or "").lower())
    return [t for t in tokens if t not in STOPWORDS and len(t) > 1]


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.num_docs = 0
        self.avg_doc_len = 0.0
        self.doc_len: List[int] = []
        self.postings: Dict[str, List[Tuple[int, int]]] = {}  # term -> [(doc_idx, term_freq)]

    def build(self, texts: List[str]) -> None:
        """(Re)build the index. Document ids are the positions in `texts`."""
        self.num_docs = len(texts)
        self.doc_len = []
        self.postings = {}
        for doc_idx, text in enumerate(texts):
            tokens = tokenize(text)
            self.doc_len.append(len(tokens))
            for term, freq in Counter(tokens).items():
                self.postings.setdefault(term, []).append((doc_idx, freq))
        total = sum(self.doc_len)
        self.avg_doc_len = (total / self.num_docs) if self.num_docs else 0.0

    def _idf(self, term: str) -> float:
        df = len(self.postings.get(term, ()))
        return math.log(1.0 + (self.num_docs - df + 0.5) / (df + 0.5))

    def search(self, query: str, top_k: int = 10) -> List[Tuple[int, float]]:
        """Return up to top_k (doc_idx, bm25_score) pairs, best first. Only documents with score > 0."""
        if self.num_docs == 0:
            return []
        scores: Dict[int, float] = {}
        for term in set(tokenize(query)):
            posting = self.postings.get(term)
            if not posting:
                continue
            idf = self._idf(term)
            for doc_idx, tf in posting:
                length_norm = 1.0 - self.b + self.b * (self.doc_len[doc_idx] / (self.avg_doc_len or 1.0))
                scores[doc_idx] = scores.get(doc_idx, 0.0) + idf * tf * (self.k1 + 1.0) / (tf + self.k1 * length_norm)
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        return ranked[:top_k]