import io
import re
from typing import List, Dict, Any

def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        pages_text = []
        for page_idx, page in enumerate(reader.pages):
            page_content = page.extract_text() or ""
            if page_content.strip():
                pages_text.append(page_content.strip())
        return "\n\n".join(pages_text)
    except Exception as e:
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")

def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    paragraphs.append(row_text)
        return "\n\n".join(paragraphs)
    except Exception as e:
        raise ValueError(f"Failed to extract text from DOCX: {str(e)}")

def extract_text(filename: str, file_bytes: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)
    elif lower.endswith(".docx"):
        return extract_text_from_docx(file_bytes)
    elif lower.endswith(".txt") or lower.endswith(".md"):
        try:
            return file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return file_bytes.decode("latin-1", errors="replace")
    else:
        # Attempt UTF-8 text fallback
        try:
            return file_bytes.decode("utf-8")
        except Exception:
            raise ValueError(f"Unsupported file format: {filename}. Supported formats: PDF, DOCX, TXT, MD.")

def chunk_text(
    text: str,
    target_token_size: int = 600,
    overlap_tokens: int = 100
) -> List[Dict[str, Any]]:
    """
    Splits text into chunks of target_token_size tokens with overlap_tokens overlap.
    Uses sentence boundary detection to preserve semantic coherence.
    Estimated ratio: 1 token ~ 4 characters or ~0.75 words.

    start_char / end_char are real positions in the cleaned document text
    (text.replace("\\r\\n", "\\n").strip()), so clean_text[start_char:end_char] is the
    source passage of the chunk. The chunk "text" itself joins sentences with single spaces.
    """
    clean_text = text.replace("\r\n", "\n").strip()
    if not clean_text:
        return []

    # Split into sentences, remembering where each one sits in clean_text.
    # Each entry is (sentence_text, start_char, end_char).
    sentences: List[tuple] = []
    last = 0
    for m in re.finditer(r'(?<=[.!?\n])\s+', clean_text):
        seg = clean_text[last:m.start()]
        stripped = seg.strip()
        if stripped:
            start = last + (len(seg) - len(seg.lstrip()))
            sentences.append((stripped, start, start + len(stripped)))
        last = m.end()
    tail = clean_text[last:]
    if tail.strip():
        start = last + (len(tail) - len(tail.lstrip()))
        stripped = tail.strip()
        sentences.append((stripped, start, start + len(stripped)))

    if not sentences:
        # Fallback to single string
        sentences = [(clean_text, 0, len(clean_text))]

    chunks: List[Dict[str, Any]] = []
    current: List[tuple] = []  # sentences of the chunk being built
    current_tokens = 0

    def estimate_tokens(s: str) -> int:
        # Approx 1 token per 4 characters or 0.75 words
        words = len(s.split())
        return max(1, int(words * 1.33))

    def commit(tokens: int) -> None:
        chunk_str = " ".join(t[0] for t in current)
        chunks.append({
            "chunk_index": len(chunks),
            "text": chunk_str,
            "token_estimate": tokens,
            "start_char": current[0][1],
            "end_char": current[-1][2]
        })

    sentence_idx = 0
    while sentence_idx < len(sentences):
        sent, sent_start, sent_end = sentences[sentence_idx]
        sent_tokens = estimate_tokens(sent)

        # If a single sentence exceeds target_token_size, split it by words
        if sent_tokens > target_token_size:
            # Flush the chunk being built first, so chunks stay in document order
            if current:
                commit(current_tokens)
                current = []
                current_tokens = 0

            word_spans = [(m.start(), m.end()) for m in re.finditer(r'\S+', sent)]
            word_target = int(target_token_size / 1.33)
            word_overlap = int(overlap_tokens / 1.33)
            step = max(1, word_target - word_overlap)

            for w_start in range(0, len(word_spans), step):
                span_slice = word_spans[w_start:w_start + word_target]
                chunk_str = " ".join(sent[a:b] for a, b in span_slice)
                chunks.append({
                    "chunk_index": len(chunks),
                    "text": chunk_str,
                    "token_estimate": estimate_tokens(chunk_str),
                    "start_char": sent_start + span_slice[0][0],
                    "end_char": sent_start + span_slice[-1][1]
                })
            sentence_idx += 1
            continue

        if current_tokens + sent_tokens > target_token_size and current:
            commit(current_tokens)

            # Calculate overlap from the end of the chunk just committed
            overlap_sentences: List[tuple] = []
            overlap_accum = 0
            for prev in reversed(current):
                p_tokens = estimate_tokens(prev[0])
                if overlap_accum + p_tokens <= overlap_tokens:
                    overlap_sentences.insert(0, prev)
                    overlap_accum += p_tokens
                else:
                    break

            current = overlap_sentences
            current_tokens = overlap_accum

        current.append((sent, sent_start, sent_end))
        current_tokens += sent_tokens
        sentence_idx += 1

    # Remaining sentences
    if current:
        commit(current_tokens)

    return chunks