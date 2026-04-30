// Ollama HTTP client. Probes localhost:11434, lists models, and streams chat
// completions. Pure browser-side fetch — no auth, no node deps. Used by the
// AI features (Phase 3).
//
// All probe results are cached in localStorage with a 1-hour TTL so we don't
// hit the network on every render. Call `clearProbeCache()` to force a fresh
// probe (e.g. from the "Re-check" banner button after the user installs).

const DEFAULT_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2:3b";
const PROBE_TIMEOUT_MS = 800;
const PROBE_CACHE_KEY = "chatify.ollama.probe";
const PROBE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const HOST_OVERRIDE_KEY = "chatify.ollamaHost";
const MODEL_OVERRIDE_KEY = "chatify.ollamaModel";

export interface OllamaConfig {
  host: string;
  model: string;
}

export interface ProbeResult {
  reachable: boolean;
  models: string[];
  checkedAt: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function getOllamaConfig(): OllamaConfig {
  let host = DEFAULT_HOST;
  let model = DEFAULT_MODEL;
  try {
    host = localStorage.getItem(HOST_OVERRIDE_KEY) || DEFAULT_HOST;
    model = localStorage.getItem(MODEL_OVERRIDE_KEY) || DEFAULT_MODEL;
  } catch {
    // localStorage may be disabled (sandboxed iframe). Fall through.
  }
  return { host, model };
}

function loadProbeCache(): ProbeResult | null {
  try {
    const raw = localStorage.getItem(PROBE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProbeResult;
    if (Date.now() - parsed.checkedAt > PROBE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveProbeCache(result: ProbeResult): void {
  try {
    localStorage.setItem(PROBE_CACHE_KEY, JSON.stringify(result));
  } catch {
    // ignore
  }
}

export function clearProbeCache(): void {
  try {
    localStorage.removeItem(PROBE_CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Probe Ollama at `/api/tags`. Returns reachability + the list of installed
 * model names. Cached for 1 hour unless `force` is set.
 */
export async function probeOllama(
  options: { force?: boolean; host?: string } = {},
): Promise<ProbeResult> {
  if (!options.force) {
    const cached = loadProbeCache();
    if (cached) return cached;
  }
  const host = options.host ?? getOllamaConfig().host;
  const result: ProbeResult = {
    reachable: false,
    models: [],
    checkedAt: Date.now(),
  };
  try {
    const res = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      result.reachable = true;
      result.models = (json.models ?? []).map((m) => m.name);
    }
  } catch {
    // Network error / timeout / CORS / etc — leave reachable=false.
  }
  saveProbeCache(result);
  return result;
}

/**
 * Stream a chat completion from Ollama. Calls `onToken` for each chunk of
 * generated text as it arrives. Resolves with the full text when done.
 *
 * Throws on HTTP errors or unparseable streams. Caller is responsible for
 * passing an AbortSignal if it wants to support cancellation.
 */
export async function streamChat(
  cfg: OllamaConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama chat failed: HTTP ${res.status}`);
  if (!res.body) throw new Error("Ollama chat: no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Ollama emits one JSON object per line (newline-delimited JSON).
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
        };
        const tok = obj.message?.content ?? "";
        if (tok) {
          full += tok;
          onToken(tok);
        }
      } catch {
        // Skip malformed lines silently. Ollama occasionally emits
        // partially-buffered JSON which our split misses.
      }
    }
  }
  return full;
}
