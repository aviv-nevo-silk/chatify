// Unified AI backend facade. Detects which provider is available and
// dispatches chat calls to it.
//
// Default preference cascade ("auto"):
//   1. window.ai (Gemini Nano, in-browser, zero install) — preferred when
//      ready because it's free, private, and one-click for the user.
//   2. Ollama on localhost — power-user fallback. Better quality but
//      requires manual install + a 2 GB model pull.
//   3. None — show a setup banner.
//
// Users can override the cascade via the settings drawer; the preference
// is stored in localStorage as "auto" | "window-ai" | "ollama". When set
// to a specific backend, detectBackend() returns that backend if ready or
// null+not-ready otherwise — no fallback. This makes "I want to test
// Ollama specifically" predictable.

import {
  probeOllama,
  streamChat as streamChatOllama,
  getOllamaConfig,
} from "./ollama.js";
import { probeWindowAi, streamChatWindowAi } from "./window-ai.js";

export type Backend = "window-ai" | "ollama" | null;
export type BackendPreference = "auto" | "window-ai" | "ollama";

const PREF_KEY = "chatify.aiBackend";

export interface BackendInfo {
  backend: Backend;
  /** Human-readable name shown in the chip tooltip. */
  label: string;
  /** True if the backend is callable right now (false = downloading / not configured). */
  ready: boolean;
}

export function getBackendPreference(): BackendPreference {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "window-ai" || v === "ollama") return v;
  } catch {
    // ignore
  }
  return "auto";
}

export function setBackendPreference(pref: BackendPreference): void {
  try {
    if (pref === "auto") localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, pref);
  } catch {
    // ignore
  }
}

async function detectWindowAi(): Promise<BackendInfo | null> {
  const wai = await probeWindowAi();
  if (wai.available && wai.status === "ready") {
    return {
      backend: "window-ai",
      label: "Browser AI (Gemini Nano)",
      ready: true,
    };
  }
  if (wai.available && wai.status === "downloading") {
    return {
      backend: null,
      label: "Browser AI is downloading — try again in a minute",
      ready: false,
    };
  }
  return null;
}

async function detectOllama(): Promise<BackendInfo | null> {
  const oll = await probeOllama();
  if (oll.reachable && oll.models.length > 0) {
    const cfg = getOllamaConfig();
    const model = oll.models.includes(cfg.model)
      ? cfg.model
      : oll.models[0]!;
    return {
      backend: "ollama",
      label: `Ollama: ${model}`,
      ready: true,
    };
  }
  return null;
}

export async function detectBackend(): Promise<BackendInfo> {
  const pref = getBackendPreference();

  if (pref === "window-ai") {
    const info = await detectWindowAi();
    return (
      info ?? { backend: null, label: "Browser AI unavailable", ready: false }
    );
  }

  if (pref === "ollama") {
    const info = await detectOllama();
    return info ?? { backend: null, label: "Ollama unavailable", ready: false };
  }

  // "auto": prefer window.ai if ready; fall back to Ollama; otherwise the
  // window.ai-downloading state if applicable, else AI unavailable.
  const wai = await detectWindowAi();
  if (wai?.ready) return wai;
  const oll = await detectOllama();
  if (oll?.ready) return oll;
  if (wai && !wai.ready) return wai;
  return { backend: null, label: "AI unavailable", ready: false };
}

export interface ChatOptions {
  systemPrompt: string;
  userPrompt: string;
  onToken: (token: string) => void;
}

/**
 * Stream a chat completion using the chosen backend. Caller is responsible
 * for calling `detectBackend()` first to pick a backend; passing null
 * throws.
 */
export async function streamChat(
  backend: Backend,
  opts: ChatOptions,
): Promise<string> {
  if (backend === "window-ai") {
    return streamChatWindowAi(
      opts.systemPrompt,
      opts.userPrompt,
      opts.onToken,
    );
  }
  if (backend === "ollama") {
    const cfg = getOllamaConfig();
    const oll = await probeOllama();
    const model = oll.models.includes(cfg.model)
      ? cfg.model
      : (oll.models[0] ?? cfg.model);
    return streamChatOllama(
      { ...cfg, model },
      [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      opts.onToken,
    );
  }
  throw new Error("ai-backend.streamChat: no backend selected");
}
