"""
Run from the backend folder:   python test_gemini.py
Tries every Gemini model your key can see with a tiny question and prints how long each took, or the error.
"""
import os, time
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass
from google import genai

client = genai.Client(http_options={"timeout": 30000})
print("GEMINI_MODEL in .env:", os.getenv("GEMINI_MODEL"))
names = []
for m in client.models.list():
    n = (m.name or "").replace("models/", "")
    if "generateContent" in (m.supported_actions or []) and "flash" in n:
        names.append(n)
print("Models seen:", names, "\n")
for n in names[:6]:
    t0 = time.time()
    try:
        r = client.models.generate_content(model=n, contents="Reply with the single word OK.")
        print(f"{n:35s} OK   {time.time()-t0:5.1f}s  -> {r.text.strip()[:20]!r}")
    except Exception as e:
        print(f"{n:35s} FAIL {time.time()-t0:5.1f}s  -> {str(e)[:110].replace(chr(10),' ')}")