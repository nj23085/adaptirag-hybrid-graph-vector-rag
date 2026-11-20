import time
from dotenv import load_dotenv
load_dotenv()
from google import genai
from google.genai import types

# 30 second limit per call, so one slow model cannot block the test
client = genai.Client(http_options=types.HttpOptions(timeout=30000))

SKIP = ("tts", "image", "live", "audio", "embedding", "robotics", "vision", "veo", "imagen")
names = []
for m in client.models.list():
    acts = getattr(m, "supported_actions", None) or []
    n = m.name.replace("models/", "")
    if "generateContent" in acts and ("flash" in n or "lite" in n) and not any(s in n for s in SKIP):
        names.append(n)

names = names[:10]
print(f"Testing {len(names)} models (max 30s each)...")
for n in names:
    t = time.time()
    try:
        r = client.models.generate_content(model=n, contents="Reply with the single word: ok")
        print(f"{n}: {time.time() - t:.1f}s -> {(r.text or '').strip()[:20]}")
    except Exception as e:
        print(f"{n}: FAILED after {time.time() - t:.1f}s -> {str(e)[:90]}")