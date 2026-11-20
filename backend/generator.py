"""
AdaptiRAG Generation Engine

One place that talks to the language model, so every route (local, global, hybrid) reports tokens the same way:

  * Gemini and OpenAI return the EXACT number of input and output tokens they billed. We use those numbers.
  * Only when no model is available (offline fallback) do we estimate (words x 1.33), and we say so with
    `tokens_exact: False`.

Settings (backend/.env):
    GEMINI_MODEL=gemini-2.5-flash     which Gemini model writes answers
    GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite   tried in order if the first is overloaded or out of quota
    GEMINI_API_KEY=...                (also OPENAI_API_KEY=... as a second option)
"""
import os
import time
from typing import List, Dict, Any, Optional

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_TIMEOUT_S = float(os.getenv("GEMINI_TIMEOUT_S", "20"))
GEMINI_TOTAL_BUDGET_S = float(os.getenv("GEMINI_TOTAL_BUDGET_S", "40"))
# "Thinking" makes 2.5 models slower (often 5 to 15 seconds). A grounded answer from passages does not need it.
GEMINI_THINKING_BUDGET = int(os.getenv("GEMINI_THINKING_BUDGET", "0"))
# Models tried in order. Quota is counted per model, so a second model gives a second chance.
GEMINI_MODELS = [GEMINI_MODEL] + [
    m.strip()
    for m in os.getenv("GEMINI_FALLBACK_MODELS", "").split(",")
    if m.strip() and m.strip() != GEMINI_MODEL
]
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def estimate_tokens(text: str) -> int:
    """Rough token count (about 1.33 tokens per word). Used only when the model gives no real count."""
    return int(len((text or "").split()) * 1.33)


class AnswerGenerator:
    def __init__(self):
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self._gemini_client = None
        self._openai_client = None
        self._no_think: set = set()       # models that rejected the thinking setting
        self._dead: set = set()          # models that returned 404 for this key
        self._good_model = None          # last model that answered
        self._discovered = None          # cached list from Google

        if self.gemini_key:
            try:
                from google import genai
                # Give up on a stuck request after GEMINI_TIMEOUT_S seconds instead of waiting for minutes
                self._gemini_client = genai.Client(http_options={"timeout": int(GEMINI_TIMEOUT_S * 1000)})
            except Exception as e:
                print(f"[AnswerGenerator] Failed to initialize Gemini client: {e}")

        if self.openai_key:
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(api_key=self.openai_key)
            except Exception as e:
                print(f"[AnswerGenerator] Failed to initialize OpenAI client: {e}")

    # ------------------------------------------------------------------ #
    #  Model list helpers
    # ------------------------------------------------------------------ #
    def _discover_models(self) -> List[str]:
        """Ask Google which text models this API key can use (done once), newest-looking flash models first."""
        if self._discovered is not None:
            return self._discovered
        found: List[str] = []
        try:
            for m in self._gemini_client.models.list():
                name = (getattr(m, "name", "") or "").replace("models/", "")
                actions = getattr(m, "supported_actions", None) or []
                if "flash" in name and "generateContent" in actions and not any(
                    x in name for x in ("image", "tts", "live", "audio", "embedding", "robotics", "computer", "thinking")
                ):
                    found.append(name)
        except Exception as e:
            print(f"[AnswerGenerator] Could not list Gemini models: {str(e)[:120]}")
        found.sort(key=lambda n: ("lite" in n, "preview" in n or "exp" in n, n), reverse=False)
        self._discovered = found[:2]
        if self._discovered:
            print(f"[AnswerGenerator] Gemini models available to this key: {', '.join(self._discovered)}")
        return self._discovered

    def _model_order(self) -> List[str]:
        """Last working model first, then the configured ones, then whatever Google says this key can use."""
        order = ([self._good_model] if self._good_model else []) + GEMINI_MODELS + self._discover_models()
        seen, out = set(), []
        for m in order:
            if m and m not in seen and m not in self._dead:
                seen.add(m)
                out.append(m)
        return out

    @staticmethod
    def _thinking_config(model_name: str):
        """Keep thinking short so answers come back fast. Returns None for models where we do not know the setting."""
        if "flash" not in model_name:
            return None
        if "2.5" in model_name:
            return {"thinking_budget": GEMINI_THINKING_BUDGET}
        return {"thinking_level": "low"}

    # ------------------------------------------------------------------ #
    #  Shared model call with exact token usage
    # ------------------------------------------------------------------ #
    def complete(self, prompt: str, system_instruction: str, temperature: float = 0.2) -> Optional[Dict[str, Any]]:
        """
        Ask the language model. Returns
            {"text", "model", "input_tokens", "output_tokens", "tokens_exact"}
        or None when no model is configured or every model call failed.
        """
        # 1. Gemini. Each model has its own quota, so when one is overloaded (503), slow (504), out of quota (429)
        #    or missing (404) we move on to the next model. A model that fails with 404 is never tried again,
        #    and the model that worked last time is tried first, so one bad model does not slow every answer.
        if self._gemini_client:
            started = time.time()
            for model_name in self._model_order():
                if time.time() - started > GEMINI_TOTAL_BUDGET_S:
                    break  # stop hunting for a working model, the user is waiting
                for attempt in range(3):
                    use_thinking = attempt == 0
                    try:
                        cfg = {"system_instruction": system_instruction, "temperature": temperature}
                        tc = self._thinking_config(model_name) if (use_thinking and model_name not in self._no_think) else None
                        if tc:
                            cfg["thinking_config"] = tc
                        t0 = time.time()
                        res = self._gemini_client.models.generate_content(
                            model=model_name, contents=prompt, config=cfg,
                        )
                        print(f"[AnswerGenerator] {model_name} answered in {time.time() - t0:.1f}s")
                        text = res.text.strip() if res.text else ""
                        if not text:
                            break
                        self._good_model = model_name
                        usage = getattr(res, "usage_metadata", None)
                        in_tok = getattr(usage, "prompt_token_count", None) if usage else None
                        total = getattr(usage, "total_token_count", None) if usage else None
                        if in_tok is not None and total is not None:
                            # total minus prompt = visible answer + hidden "thinking" tokens, all billed as output
                            return {
                                "text": text,
                                "model": model_name,
                                "input_tokens": int(in_tok),
                                "output_tokens": max(0, int(total) - int(in_tok)),
                                "tokens_exact": True,
                            }
                        return {
                            "text": text,
                            "model": model_name,
                            "input_tokens": estimate_tokens(prompt + system_instruction),
                            "output_tokens": estimate_tokens(text),
                            "tokens_exact": False,
                        }
                    except Exception as e:
                        msg = str(e)
                        low = msg.lower()
                        if "404" in msg or "NOT_FOUND" in msg:
                            self._dead.add(model_name)
                            print(f"[AnswerGenerator] {model_name} is not available for this key, skipping it from now on.")
                            break
                        # Some models reject the thinking setting: retry once without it
                        if attempt == 0 and tc and ("thinking" in low or "INVALID_ARGUMENT" in msg):
                            self._no_think.add(model_name)
                            continue
                        if attempt < 2 and ("503" in msg or "UNAVAILABLE" in msg):
                            time.sleep(2 * (attempt + 1))  # overload spikes are short: wait 2s, then 4s
                            continue
                        print(f"[AnswerGenerator] {model_name} failed: {msg[:160].replace(chr(10), ' ')}")
                        break
            print("[AnswerGenerator] All Gemini models failed. Trying fallback.")

        # 2. OpenAI
        if self._openai_client:
            try:
                completion = self._openai_client.chat.completions.create(
                    model=OPENAI_MODEL,
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=temperature,
                )
                text = (completion.choices[0].message.content or "").strip()
                if text:
                    u = completion.usage
                    return {
                        "text": text,
                        "model": OPENAI_MODEL,
                        "input_tokens": int(u.prompt_tokens) if u else estimate_tokens(prompt),
                        "output_tokens": int(u.completion_tokens) if u else estimate_tokens(text),
                        "tokens_exact": bool(u),
                    }
            except Exception as e:
                print(f"[AnswerGenerator] OpenAI generation error: {e}. Trying fallback.")

        return None

    @staticmethod
    def _result(answer: str, model: str, in_tok: int, out_tok: int, exact: bool) -> Dict[str, Any]:
        return {
            "answer": answer,
            "tokens_used": in_tok + out_tok,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "tokens_exact": exact,
            "model": model,
        }

    # ------------------------------------------------------------------ #
    #  Local route
    # ------------------------------------------------------------------ #
    def generate_grounded_answer(self, query: str, citations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Answer strictly from the retrieved chunks, citing each chunk."""
        if not citations:
            return self._result(
                "No relevant documents found in the vector index to answer your question.", "rule-based", 0, 0, True
            )

        context_blocks = []
        for c in citations:
            context_blocks.append(
                f"Source: [Doc: {c.get('filename')}, Chunk: {c.get('chunk_index')}, "
                f"Chars: {c.get('start_char')}-{c.get('end_char')}, Score: {c.get('score')}]\n"
                f"{c.get('text', '').strip()}"
            )
        context_str = "\n\n---\n\n".join(context_blocks)

        system_instruction = (
            "You are AdaptiRAG's Factual Question-Answering Agent.\n"
            "Your task is to provide an accurate, clear, and factual answer based STRICTLY on the provided context passages.\n"
            "Rules:\n"
            "1. Only state facts directly supported by the context.\n"
            "2. Whenever you state a claim or fact, cite the source chunk immediately using the exact notation [Doc: <filename>, Chunk: <index>].\n"
            "3. If the context does not contain enough information to fully answer the question, clearly state what information is missing.\n"
            "4. Be concise, direct, and well-structured."
        )
        prompt = (
            f"Context Passages:\n\n{context_str}\n\n"
            f"Question: {query}\n\n"
            f"Grounded Answer (with [Doc: <filename>, Chunk: <index>] citations):"
        )

        out = self.complete(prompt, system_instruction)
        if out:
            return self._result(out["text"], out["model"], out["input_tokens"], out["output_tokens"], out["tokens_exact"])

        # Offline fallback: show the best passage itself, no model involved
        best = citations[0]
        summary = (
            f"Based on {best['filename']} [Chunk #{best['chunk_index']}]:\n"
            f"\"{best['text'][:300]}...\"\n\n"
            f"[Doc: {best['filename']}, Chunk: {best['chunk_index']}]"
        )
        return self._result(summary, "extractive-fallback", 0, estimate_tokens(summary), False)

    # ------------------------------------------------------------------ #
    #  Hybrid route (passages + graph communities)
    # ------------------------------------------------------------------ #
    def generate_hybrid_answer(
        self,
        query: str,
        vector_citations: List[Dict[str, Any]],
        community_citations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Answer from retrieved passages AND knowledge-graph community summaries together."""
        if not vector_citations and not community_citations:
            return self._result("No relevant evidence was found for this question.", "rule-based", 0, 0, True)

        passages = "\n\n".join(
            f"[Doc: {c.get('filename')}, Chunk: {c.get('chunk_index')}]\n{(c.get('text') or '').strip()}"
            for c in vector_citations
        )
        communities = "\n\n".join(
            f"[Community: {c.get('title')}]\n{c.get('summary', '')}" for c in community_citations
        )

        system_instruction = (
            "You are AdaptiRAG's Hybrid Question-Answering Agent.\n"
            "Answer using BOTH the document passages (specific facts) and the knowledge-graph community summaries "
            "(how the facts connect).\n"
            "Rules:\n"
            "1. Only state what the provided evidence supports.\n"
            "2. Cite passages as [Doc: <filename>, Chunk: <index>] and communities as [Community: <title>].\n"
            "3. If the evidence does not fully answer the question, say what is missing.\n"
            "4. Be concise and well-structured."
        )
        prompt = (
            f"Document passages:\n\n{passages or '(none)'}\n\n"
            f"Knowledge graph communities:\n\n{communities or '(none)'}\n\n"
            f"Question: {query}\n\n"
            "Grounded answer:"
        )

        out = self.complete(prompt, system_instruction)
        if out:
            return self._result(out["text"], out["model"], out["input_tokens"], out["output_tokens"], out["tokens_exact"])

        # Offline fallback built only from the real retrieved evidence
        parts = ["No language model is available, so here is the retrieved evidence itself.\n"]
        if vector_citations:
            top = vector_citations[0]
            parts.append(
                f"From {top.get('filename')} [Doc: {top.get('filename')}, Chunk: {top.get('chunk_index')}]:\n"
                f"\"{(top.get('text') or '')[:300].strip()}...\""
            )
        for c in community_citations[:2]:
            parts.append(f"From the knowledge graph [Community: {c.get('title')}]:\n{c.get('summary', '')}")
        text = "\n\n".join(parts)
        return self._result(text, "extractive-fallback", 0, estimate_tokens(text), False)


generator = AnswerGenerator()