// Browser-native AI client (Chrome's Prompt API / window.ai / Gemini Nano).
// The shape of this API has shifted across Chrome versions — at the time of
// writing, three names exist in the wild:
//
//   1. Global `LanguageModel`      (Chrome 138+, current standardization path)
//   2. `window.ai.languageModel`   (Chrome 128–137, mid-2024 origin trial)
//   3. `window.ai.createTextSession` (Chrome 122–127, earliest origin trial)
//
// We probe each in order and use whichever is available. Streaming output
// also varies between deltas (newer) and cumulative strings (older); the
// reader handles both shapes.

export interface WindowAiProbeResult {
  available: boolean;
  status: "ready" | "downloading" | "unavailable";
}

interface SessionLike {
  promptStreaming(text: string): ReadableStream<string>;
}

interface SessionInit {
  systemPrompt?: string;
}

// Defensive global access — none of these are typed in the standard DOM lib
// yet, so we hop through `any` rather than declaring them.
function getGlobals(): { LM?: unknown; ai?: unknown } {
  const g = globalThis as unknown as {
    LanguageModel?: unknown;
    ai?: unknown;
    window?: { ai?: unknown };
  };
  return { LM: g.LanguageModel, ai: g.ai ?? g.window?.ai };
}

function normalizeAvailability(value: unknown): WindowAiProbeResult {
  // The API has used different vocabulary at different points: "readily",
  // "available", "after-download", "downloadable", "no", "unavailable".
  if (value === "readily" || value === "available") {
    return { available: true, status: "ready" };
  }
  if (value === "after-download" || value === "downloadable") {
    return { available: true, status: "downloading" };
  }
  return { available: false, status: "unavailable" };
}

export async function probeWindowAi(): Promise<WindowAiProbeResult> {
  const { LM, ai } = getGlobals();
  // Chrome 138+: global LanguageModel.availability()
  const lm = LM as { availability?: () => Promise<unknown> } | undefined;
  if (lm?.availability) {
    try {
      return normalizeAvailability(await lm.availability());
    } catch {
      // fall through
    }
  }
  // Mid-2024: window.ai.languageModel.availability()
  const aiObj = ai as
    | {
        languageModel?: { availability?: () => Promise<unknown> };
        canCreateTextSession?: () => Promise<unknown>;
      }
    | undefined;
  if (aiObj?.languageModel?.availability) {
    try {
      return normalizeAvailability(await aiObj.languageModel.availability());
    } catch {
      // fall through
    }
  }
  // Early 2024: window.ai.canCreateTextSession()
  if (aiObj?.canCreateTextSession) {
    try {
      return normalizeAvailability(await aiObj.canCreateTextSession());
    } catch {
      // fall through
    }
  }
  return { available: false, status: "unavailable" };
}

async function createSession(init: SessionInit): Promise<SessionLike | null> {
  const { LM, ai } = getGlobals();
  const lm = LM as { create?: (init: SessionInit) => Promise<SessionLike> } | undefined;
  if (lm?.create) {
    try {
      return await lm.create(init);
    } catch {
      // fall through
    }
  }
  const aiObj = ai as
    | {
        languageModel?: { create?: (init: SessionInit) => Promise<SessionLike> };
        createTextSession?: (init: SessionInit) => Promise<SessionLike>;
      }
    | undefined;
  if (aiObj?.languageModel?.create) {
    try {
      return await aiObj.languageModel.create(init);
    } catch {
      // fall through
    }
  }
  if (aiObj?.createTextSession) {
    try {
      return await aiObj.createTextSession(init);
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * Stream a prompt against the browser's built-in language model. Calls
 * `onToken` for each new piece of generated text. Returns the full text.
 *
 * Throws if no compatible browser API is found.
 */
export async function streamChatWindowAi(
  systemPrompt: string,
  userPrompt: string,
  onToken: (token: string) => void,
): Promise<string> {
  const session = await createSession({ systemPrompt });
  if (!session) throw new Error("window.ai: no compatible API found");

  const stream = session.promptStreaming(userPrompt);
  const reader = stream.getReader();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (typeof value !== "string") continue;
    // Newer Chrome: each chunk is cumulative (full text so far).
    // Older Chrome: each chunk is just the new delta.
    if (value.startsWith(full) && value.length > full.length) {
      const delta = value.slice(full.length);
      full = value;
      onToken(delta);
    } else {
      full += value;
      onToken(value);
    }
  }
  return full;
}
