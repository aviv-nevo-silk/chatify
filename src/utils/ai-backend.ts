// Unified AI backend facade. Detects which provider is available and
// dispatches chat calls to it. Order of preference:
//
//   1. window.ai (Gemini Nano, in-browser, zero install) — preferred when
//      ready because it's free, private, and one-click for the user.
//   2. Ollama on localhost — power-user fallback. Better quality but
//      requires manual install + a 2 GB model pull.
//   3. None — show a setup banner.
//
// Adding more backends (Claude API key, OpenAI, Gemini cloud) just means
// inserting another probe and dispatch case here without touching the
// caller in ai-summarize.ts.

import {
  probeOllama,
  streamChat as streamChatOllama,
  getOllamaConfig,
} from "./ollama.js";
import { probeWindowAi, streamChatWindowAi } from "./window-ai.js";

export type Backend = "window-ai" | "ollama" | null;

export interface BackendInfo {
  backend: Backend;
  /** Human-readable name shown in the chip tooltip. */
  label: string;
  /** True if the backend is callable right now (false = downloading / not configured). */
  ready: boolean;
}

export async function detectBackend(): Promise<BackendInfo> {
  const wai = await probeWindowAi();
  if (wai.available && wai.status === "ready") {
    return {
      backend: "window-ai",
      label: "Browser AI (Gemini Nano)",
      ready: true,
    };
  }

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

  // window.ai is downloading? Surface that as a "not yet" state so the UI
  // can show a different message ("Browser AI is downloading…") rather
  // than the install banner.
  if (wai.available && wai.status === "downloading") {
    return {
      backend: null,
      label: "Browser AI is downloading — try again in a minute",
      ready: false,
    };
  }

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
    // Re-probe to find an installed model (in case the user-configured one
    // was uninstalled since the last detect).
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
