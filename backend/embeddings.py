"""
AdaptiRAG Embedding Engine
Supports Hosted API Embeddings (Gemini / OpenAI) with local fallback.
"""
import os
import re
import math
import hashlib
import numpy as np
from typing import List, Optional

class EmbeddingEngine:
    def __init__(self, preferred_provider: Optional[str] = None):
        self.preferred_provider = preferred_provider or os.getenv("EMBEDDING_PROVIDER", "auto")
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")

        # Determine active provider
        if self.preferred_provider == "openai" and self.openai_key:
            self.provider = "openai"
            self.model_name = "text-embedding-3-small"
            self.dimension = 1536
        elif (self.preferred_provider in ("gemini", "auto")) and self.gemini_key:
            self.provider = "gemini"
            self.model_name = "gemini-embedding-001"
            self.dimension = 3072
        elif self.preferred_provider == "openai" and not self.openai_key:
            print("[EmbeddingEngine] OPENAI_API_KEY not found, falling back to Gemini or local.")
            if self.gemini_key:
                self.provider = "gemini"
                self.model_name = "gemini-embedding-001"
                self.dimension = 3072
            else:
                self.provider = "local_hash"
                self.model_name = "local-dense-hasher-384"
                self.dimension = 384
        else:
            self.provider = "local_hash"
            self.model_name = "local-dense-hasher-384"
            self.dimension = 384

        self._init_clients()

    def _init_clients(self):
        self._gemini_client = None
        self._openai_client = None

        if self.provider == "gemini":
            try:
                from google import genai
                self._gemini_client = genai.Client()
            except Exception as e:
                print(f"[EmbeddingEngine] Warning initializing Gemini client: {e}. Using local fallback.")
                self.provider = "local_hash"
                self.model_name = "local-dense-hasher-384"
                self.dimension = 384

        elif self.provider == "openai":
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=self.openai_key)
            except Exception as e:
                print(f"[EmbeddingEngine] Warning initializing OpenAI client: {e}. Using local fallback.")
                self.provider = "local_hash"
                self.model_name = "local-dense-hasher-384"
                self.dimension = 384

    def _local_hash_embed(self, text: str) -> np.ndarray:
        """
        Deterministic lightweight semantic hash embedding (384 dimensions).
        Uses word tokens and subword character n-grams with Murmur-style hashing,
        scaled by sublinear term frequencies and normalized to unit L2 norm.
        """
        dim = 384
        vec = np.zeros(dim, dtype=np.float32)
        words = re.findall(r"\b\w+\b", text.lower())
        if not words:
            return vec

        for word in words:
            # Word level feature
            h = int(hashlib.md5(word.encode("utf-8")).hexdigest()[:8], 16) % dim
            vec[h] += 1.0

            # Subword 3-grams
            if len(word) >= 3:
                for i in range(len(word) - 2):
                    gram = word[i:i+3]
                    h_gram = int(hashlib.sha256(gram.encode("utf-8")).hexdigest()[:8], 16) % dim
                    vec[h_gram] += 0.4

        # Sublinear TF scaling
        vec = np.sign(vec) * np.log1p(np.abs(vec))
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Embed a list of text passages."""
        if not texts:
            return np.empty((0, self.dimension), dtype=np.float32)

        if self.provider == "gemini" and self._gemini_client:
            try:
                # Gemini batch or iterative embedding
                embeddings_list = []
                # Batch in groups of 10 to avoid payload limits
                batch_size = 10
                for i in range(0, len(texts), batch_size):
                    batch = texts[i:i+batch_size]
                    res = self._gemini_client.models.embed_content(
                        model=self.model_name,
                        contents=batch,
                    )
                    for emb in res.embeddings:
                        vec = np.array(emb.values, dtype=np.float32)
                        norm = np.linalg.norm(vec)
                        if norm > 0:
                            vec = vec / norm
                        embeddings_list.append(vec)
                return np.vstack(embeddings_list)
            except Exception as e:
                print(f"[EmbeddingEngine] Gemini API error: {e}. Falling back to local hash.")

        elif self.provider == "openai" and self._openai_client:
            try:
                res = self._openai_client.embeddings.create(
                    input=texts,
                    model=self.model_name
                )
                embeddings_list = []
                for item in res.data:
                    vec = np.array(item.embedding, dtype=np.float32)
                    norm = np.linalg.norm(vec)
                    if norm > 0:
                        vec = vec / norm
                    embeddings_list.append(vec)
                return np.vstack(embeddings_list)
            except Exception as e:
                print(f"[EmbeddingEngine] OpenAI API error: {e}. Falling back to local hash.")

        # Local fallback
        vectors = [self._local_hash_embed(t) for t in texts]
        return np.vstack(vectors)

    def embed_query(self, query: str) -> np.ndarray:
        """Embed a single search query."""
        res = self.embed_texts([query])
        return res[0]

    def get_info(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model_name,
            "dimension": self.dimension,
            "has_gemini_key": bool(self.gemini_key),
            "has_openai_key": bool(self.openai_key),
        }

# Global singleton instance
engine = EmbeddingEngine()
