# Enabling AI features (optional, local)

Chatify can summarize email threads using a local LLM. Everything runs on your machine — your email content never leaves your computer.

There are **two backends**, picked automatically in this order:

1. **Browser-native AI** (Chrome / Edge 138+) — uses Gemini Nano built into the browser. Zero install, no model download (Chrome handles that silently). Smaller model, OK for summarization. **Try this first.**
2. **Ollama** on `localhost:11434` — better quality, requires a one-time install + ~2 GB model pull. Power-user fallback.

## What you get

A `🧠 Summarize` chip below the thread header. Click it → Chatify sends the rendered conversation text to whichever backend is available → the TL;DR streams into a card above the bubbles.

Future ideas (translation chips, action-item extraction, Q&A) layer on the same plumbing.

## Path A — Browser-native (Chrome 138+ / Edge)

If you're on a recent Chrome or Edge, you may already have AI built in:

1. Open `chrome://flags` (or `edge://flags`) → search for "Prompt API" → enable.
2. Open `chrome://components/` → look for "Optimization Guide On Device Model" → click "Check for update". Chrome downloads ~3 GB silently in the background.
3. Once status shows "ready", reload the Chatify task pane. Chip should appear.

If your Chrome version doesn't expose this yet, skip to Path B.

## Path B — Ollama (any browser, more setup, better quality)

### Install Ollama

**Linux / macOS:**

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:** download the installer from <https://ollama.com/download>.

After install, Ollama runs as a background service on `http://localhost:11434`.

## Pull a small model

```bash
ollama pull llama3.2:3b
```

This is ~2 GB. Llama 3.2 3B is small enough to run on a laptop CPU and produces decent thread summaries. Alternatives:

| Model | Size | Notes |
|---|---|---|
| `llama3.2:3b` | ~2 GB | Default. Fast, OK summaries. |
| `qwen2.5:3b` | ~2 GB | Slightly better at non-English content. |
| `phi3.5:3.8b` | ~2.4 GB | Sharper at structured output. |
| `llama3.1:8b` | ~5 GB | Better quality, slower on CPU. |

To use a different model, set it once in the browser console of the task pane (or the dev page):

```js
localStorage.setItem("chatify.ollamaModel", "qwen2.5:3b");
```

## Verify Ollama is running

```bash
curl http://localhost:11434/api/tags
```

You should get a JSON response listing your installed models.

## Enable AI features in Chatify

In the task pane (or `https://aviv-nevo-silk.github.io/chatify/dev.html`), open the browser DevTools console and run:

```js
localStorage.setItem("chatify.aiEnabled", "true");
```

Reload. A `🧠 Summarize` chip appears below the thread header. Click to generate a TL;DR.

To turn it off again:

```js
localStorage.removeItem("chatify.aiEnabled");
```

## Troubleshooting

**Re-check loops back to the install banner.** Ollama isn't reachable. Confirm `ollama serve` is running (it usually starts automatically post-install). On Linux: `systemctl status ollama`. On macOS: check the Ollama menubar icon.

**CORS errors in the console.** Ollama only allows requests from approved origins. Set `OLLAMA_ORIGINS` in the env where Ollama runs:

```bash
# Linux: edit /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl edit ollama
# add: Environment="OLLAMA_ORIGINS=*"
sudo systemctl restart ollama

# macOS / quick test:
OLLAMA_ORIGINS="*" ollama serve
```

For production, prefer a stricter origin list:

```
OLLAMA_ORIGINS=https://aviv-nevo-silk.github.io,https://outlook.office.com,https://outlook.live.com
```

**Mixed-content blocked.** Modern browsers (Chrome 94+, Firefox, Edge) treat `http://localhost` as a secure context, so this shouldn't happen. If yours does, run an HTTPS proxy in front of Ollama:

```bash
caddy reverse-proxy --from https://localhost:11435 --to localhost:11434
```

Caddy auto-generates a trusted local cert. Then point Chatify at it:

```js
localStorage.setItem("chatify.ollamaHost", "https://localhost:11435");
```

## Privacy

100% local. Chatify sends the rendered conversation text to your local Ollama instance and **nothing else** — no telemetry, no cloud calls, no API key. The model itself is offline-only after the initial `ollama pull`.

If your IT department or compliance team needs evidence: every network call from the AI features is to `http://localhost:11434` (or your override host). This is auditable in DevTools → Network.
