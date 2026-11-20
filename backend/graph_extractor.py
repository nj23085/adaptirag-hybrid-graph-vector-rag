"""
AdaptiRAG Graph Extractor

Finds the important entities (people, organisations, products, technologies, concepts ...) and the
relationships between them in ANY kind of document. Nothing here is tied to one subject area.

How it works
  1. Chunks are sent to Gemini in small batches (GRAPH_BATCH_SIZE chunks per request, default 4), so a
     12-chunk document needs 3 requests instead of 12. This keeps us inside the free-tier limit.
  2. If Gemini is overloaded (503) or out of quota (429) the next model in the list is tried.
  3. If no model can answer, a simple offline extractor runs instead: it picks capitalised names and
     acronyms from the text and links the ones that appear in the same sentence.

Settings (backend/.env), all optional:
    GRAPH_MODEL=                             leave empty to use the answer generator's working models
    GRAPH_FALLBACK_MODELS=                   tried in order after GRAPH_MODEL
    GRAPH_BATCH_SIZE=4
"""
import os
import re
import json
import time
from collections import Counter
from typing import List, Dict, Any, Tuple

# Leave GRAPH_MODEL empty to use the same working model list as the answer generator (recommended).
GRAPH_MODEL = os.getenv("GRAPH_MODEL", "").strip()
GRAPH_FALLBACK = [m.strip() for m in os.getenv("GRAPH_FALLBACK_MODELS", "").split(",") if m.strip()]
BATCH_SIZE = max(1, int(os.getenv("GRAPH_BATCH_SIZE", "4")))

ENTITY_TYPES = "PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY, CONCEPT, LOCATION, EVENT, METRIC, OTHER"

# Words that start sentences or are too generic to be useful entities
_STOP = {
    "the", "a", "an", "this", "that", "these", "those", "it", "its", "in", "on", "at", "for", "of", "and",
    "or", "but", "with", "by", "from", "as", "to", "is", "are", "was", "were", "be", "we", "our", "they",
    "their", "he", "she", "his", "her", "you", "your", "if", "when", "while", "also", "however", "there",
    "here", "then", "thus", "such", "each", "all", "any", "some", "one", "two", "three", "figure", "table",
    "section", "chapter", "page", "note", "see", "for example", "introduction", "conclusion", "abstract",
    "references", "overview", "summary", "page", "name", "date", "title", "total", "other",
}

_NAME_RE = re.compile(
    r"\b[A-Z][\w&\-]+(?:\s+(?:of\s+)?[A-Z][\w&\-]+){0,3}"
)


class GraphExtractor:
    def __init__(self):
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self._gemini_client = None
        if self.gemini_key:
            try:
                from google import genai
                self._gemini_client = genai.Client()
            except Exception as e:
                print(f"[GraphExtractor] Gemini init note: {e}")

    # ------------------------------------------------------------------ #
    #  Names
    # ------------------------------------------------------------------ #
    @staticmethod
    def normalize_name(name: str) -> str:
        """Tidy an entity name without changing its meaning (no domain dictionary)."""
        cleaned = re.sub(r"[\s_]+", " ", (name or "").strip()).strip(" .,:;\"'()[]")
        cleaned = re.sub(r"^(the|a|an)\s+", "", cleaned, flags=re.IGNORECASE)
        if not cleaned or len(cleaned) < 2 or cleaned.lower() in _STOP:
            return ""
        # Only fix names typed entirely in lower case, e.g. "state machine replication"
        if cleaned == cleaned.lower():
            cleaned = " ".join(w.capitalize() for w in cleaned.split())
        return cleaned

    # ------------------------------------------------------------------ #
    #  Public API
    # ------------------------------------------------------------------ #
    def extract_batch(self, chunks: List[Any]) -> List[Tuple[Any, Dict[str, Any]]]:
        """
        chunks: objects with .text, .document_id, .chunk_index.
        Returns [(chunk, {"entities": [...], "relationships": [...]})]. The result of a batch is attached to
        the first chunk of that batch (the later chunks get an empty result), which is all the caller needs
        because it merges everything into one graph.
        """
        out: List[Tuple[Any, Dict[str, Any]]] = []
        empty = {"entities": [], "relationships": []}

        # Batch only chunks of the same document, so every entity keeps the right document_id
        by_doc: Dict[int, List[Any]] = {}
        for c in chunks:
            by_doc.setdefault(c.document_id, []).append(c)

        for doc_id, doc_chunks in by_doc.items():
            for i in range(0, len(doc_chunks), BATCH_SIZE):
                batch = doc_chunks[i:i + BATCH_SIZE]
                result = self.extract_texts([c.text for c in batch], doc_id)
                out.append((batch[0], result))
                out.extend((c, dict(empty)) for c in batch[1:])
        return out

    def extract_from_chunk(self, chunk_text: str, document_id: int, chunk_index: int = 0) -> Dict[str, Any]:
        """Single-chunk version (kept for older callers)."""
        return self.extract_texts([chunk_text], document_id)

    def extract_texts(self, texts: List[str], document_id: int) -> Dict[str, Any]:
        if self._gemini_client:
            result = self._extract_with_gemini(texts, document_id)
            if result is not None:
                return result
        return self._extract_offline(texts, document_id)

    # ------------------------------------------------------------------ #
    #  Gemini
    # ------------------------------------------------------------------ #
    def _extract_with_gemini(self, texts: List[str], document_id: int):
        body = "\n\n".join(f"[Passage {i + 1}]\n{t.strip()}" for i, t in enumerate(texts))
        prompt = (
            "You build a knowledge graph from a document of any subject.\n"
            "Read the passages and extract the important named entities and how they relate.\n"
            f"Entity types: {ENTITY_TYPES}.\n"
            "Rules:\n"
            "- Use only what the text says. Do not add outside knowledge.\n"
            "- Use each entity's full, most common name, and the same spelling every time.\n"
            "- Skip generic words such as 'the company', 'the system', 'table', 'figure'.\n"
            "- Keep at most 12 entities and 15 relationships per passage.\n"
            "- A relationship description is a short verb phrase, like 'acquired', 'is part of', 'uses'.\n"
            "Return ONLY valid JSON in exactly this shape:\n"
            '{"entities":[{"name":"","type":"","description":"one sentence from the text"}],'
            '"relationships":[{"source":"","target":"","description":"","weight":1.0}]}\n\n'
            f"{body}"
        )

        for model_name in self._models():
            for attempt in range(2):
                try:
                    res = self._gemini_client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config={"response_mime_type": "application/json", "temperature": 0.1},
                    )
                    data = self._parse_json(res.text or "")
                    if data is None:
                        break
                    return self._clean(data, document_id)
                except Exception as e:
                    msg = str(e)
                    if "404" in msg or "NOT_FOUND" in msg:
                        try:
                            from generator import generator
                            generator._dead.add(model_name)
                        except Exception:
                            pass
                        break
                    if attempt == 0 and ("503" in msg or "UNAVAILABLE" in msg):
                        time.sleep(3)
                        continue
                    if attempt == 0 and "429" in msg:
                        wait = self._retry_delay(msg)
                        if wait is not None and wait <= 20:
                            time.sleep(wait + 1)
                            continue
                    print(f"[GraphExtractor] {model_name} failed: {msg[:140].replace(chr(10), ' ')}")
                    break
        print("[GraphExtractor] Gemini unavailable, using the offline extractor for this batch.")
        return None

    @staticmethod
    def _models() -> List[str]:
        if GRAPH_MODEL:
            return [GRAPH_MODEL] + [m for m in GRAPH_FALLBACK if m != GRAPH_MODEL]
        from generator import generator
        return generator._model_order()

    @staticmethod
    def _retry_delay(msg: str):
        m = re.search(r"retry in ([0-9.]+)s", msg)
        return float(m.group(1)) if m else None

    @staticmethod
    def _parse_json(raw: str):
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        try:
            return json.loads(raw)
        except Exception:
            m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    return None
        return None

    def _clean(self, data: Dict[str, Any], document_id: int) -> Dict[str, Any]:
        canon: Dict[str, str] = {}   # lower-case name -> first spelling seen
        entities: Dict[str, Dict[str, Any]] = {}

        def canonical(raw: str) -> str:
            name = self.normalize_name(raw)
            if not name:
                return ""
            return canon.setdefault(name.lower(), name)

        for ent in data.get("entities", []) or []:
            name = canonical(str(ent.get("name", "")))
            if not name:
                continue
            etype = str(ent.get("type", "CONCEPT")).upper().strip() or "CONCEPT"
            desc = str(ent.get("description", "") or "")
            if name not in entities or len(desc) > len(entities[name]["description"]):
                entities[name] = {"name": name, "type": etype, "description": desc, "document_id": document_id}

        rels = []
        for rel in data.get("relationships", []) or []:
            src = canonical(str(rel.get("source", "")))
            tgt = canonical(str(rel.get("target", "")))
            if not src or not tgt or src == tgt:
                continue
            # A relationship may mention an entity the model forgot to list: add it
            for n in (src, tgt):
                if n not in entities:
                    entities[n] = {"name": n, "type": "CONCEPT", "description": "", "document_id": document_id}
            try:
                weight = float(rel.get("weight", 1.0))
            except Exception:
                weight = 1.0
            rels.append({
                "source": src, "target": tgt,
                "description": str(rel.get("description", "") or "related to"),
                "weight": weight, "document_id": document_id,
            })
        return {"entities": list(entities.values()), "relationships": rels}

    # ------------------------------------------------------------------ #
    #  Offline fallback (no model, any subject)
    # ------------------------------------------------------------------ #
    def _extract_offline(self, texts: List[str], document_id: int) -> Dict[str, Any]:
        text = "\n".join(texts)
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]

        per_sentence: List[List[str]] = []
        counts: Counter = Counter()
        for s in sentences:
            found = []
            for m in _NAME_RE.finditer(s):
                name = self.normalize_name(m.group(0))
                if not name:
                    continue
                words = name.split()
                # A single capitalised word at the very start of a sentence is usually just a normal word
                if len(words) == 1 and m.start() == 0 and not name.isupper():
                    continue
                if name.lower() in _STOP or all(w.lower() in _STOP for w in words):
                    continue
                found.append(name)
            found = list(dict.fromkeys(found))
            per_sentence.append(found)
            counts.update(found)

        # Keep names that matter: seen twice or more, or multi-word names
        keep = {n for n, c in counts.items() if c >= 2 or len(n.split()) >= 2}
        top = {n for n, _ in counts.most_common(15) if n in keep}

        entities = []
        for n in top:
            sent = next((s for s, f in zip(sentences, per_sentence) if n in f), "")
            entities.append({
                "name": n, "type": "ACRONYM" if n.isupper() else "CONCEPT",
                "description": sent[:240], "document_id": document_id,
            })

        pair_counts: Counter = Counter()
        for found in per_sentence:
            names = [n for n in found if n in top]
            for i in range(len(names)):
                for j in range(i + 1, len(names)):
                    pair_counts[tuple(sorted((names[i], names[j])))] += 1
        rels = [
            {"source": a, "target": b, "description": "mentioned together with",
             "weight": float(c), "document_id": document_id}
            for (a, b), c in pair_counts.most_common(20)
        ]
        return {"entities": entities, "relationships": rels}


graph_extractor = GraphExtractor()