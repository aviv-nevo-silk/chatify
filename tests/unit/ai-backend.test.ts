import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectBackend,
  streamChat,
  getBackendPreference,
  setBackendPreference,
} from "../../src/utils/ai-backend";
import { clearProbeCache } from "../../src/utils/ollama";

const tagsResponse = (models: string[]) =>
  new Response(JSON.stringify({ models: models.map((n) => ({ name: n })) }), {
    status: 200,
  });

function ndjsonResponse(text: string): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        enc.encode(JSON.stringify({ message: { content: text } }) + "\n"),
      );
      controller.enqueue(enc.encode(JSON.stringify({ done: true }) + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function stringStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  clearProbeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).LanguageModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).ai;
});

describe("ai-backend.detectBackend", () => {
  it("prefers window.ai when it's ready", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
    };
    // Even with Ollama up, we should pick window.ai.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const info = await detectBackend();
    expect(info.backend).toBe("window-ai");
    expect(info.ready).toBe(true);
    expect(info.label).toMatch(/Gemini Nano/);
  });

  it("falls back to Ollama when window.ai is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const info = await detectBackend();
    expect(info.backend).toBe("ollama");
    expect(info.ready).toBe(true);
    expect(info.label).toContain("llama3.2:3b");
  });

  it("surfaces 'downloading' state for window.ai when Ollama also unavailable", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("after-download"),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("net")),
    );
    const info = await detectBackend();
    expect(info.backend).toBeNull();
    expect(info.ready).toBe(false);
    expect(info.label.toLowerCase()).toContain("download");
  });

  it("returns null backend with 'AI unavailable' when nothing is reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("net")),
    );
    const info = await detectBackend();
    expect(info.backend).toBeNull();
    expect(info.ready).toBe(false);
    expect(info.label).toContain("unavailable");
  });

  it("returns null when Ollama is reachable but no models installed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse([])),
    );
    const info = await detectBackend();
    expect(info.backend).toBeNull();
  });

  it("respects preference='window-ai' even when Ollama is also ready", async () => {
    setBackendPreference("window-ai");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const info = await detectBackend();
    expect(info.backend).toBe("window-ai");
  });

  it("respects preference='ollama' even when window.ai is ready (no auto fallback)", async () => {
    setBackendPreference("ollama");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const info = await detectBackend();
    expect(info.backend).toBe("ollama");
    expect(info.label).toContain("llama3.2:3b");
  });

  it("preference='ollama' returns 'unavailable' when Ollama is not reachable, no fallback", async () => {
    setBackendPreference("ollama");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
    };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const info = await detectBackend();
    expect(info.backend).toBeNull();
    expect(info.label).toContain("Ollama unavailable");
  });

  it("preference='window-ai' returns 'unavailable' when window.ai is missing, no fallback", async () => {
    setBackendPreference("window-ai");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const info = await detectBackend();
    expect(info.backend).toBeNull();
    expect(info.label).toContain("Browser AI unavailable");
  });
});

describe("ai-backend preference helpers", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'auto' when nothing set", () => {
    expect(getBackendPreference()).toBe("auto");
  });

  it("setBackendPreference('auto') removes the key", () => {
    localStorage.setItem("chatify.aiBackend", "ollama");
    setBackendPreference("auto");
    expect(localStorage.getItem("chatify.aiBackend")).toBeNull();
  });

  it("round-trips 'window-ai' and 'ollama'", () => {
    setBackendPreference("window-ai");
    expect(getBackendPreference()).toBe("window-ai");
    setBackendPreference("ollama");
    expect(getBackendPreference()).toBe("ollama");
  });
});

describe("ai-backend.streamChat", () => {
  it("dispatches to window.ai when backend is 'window-ai'", async () => {
    const session = {
      promptStreaming: vi.fn().mockReturnValue(stringStream(["hello"])),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      create: vi.fn().mockResolvedValue(session),
    };
    const tokens: string[] = [];
    const full = await streamChat("window-ai", {
      systemPrompt: "sys",
      userPrompt: "user",
      onToken: (t) => tokens.push(t),
    });
    expect(full).toBe("hello");
    expect(tokens).toEqual(["hello"]);
  });

  it("dispatches to Ollama when backend is 'ollama'", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) return tagsResponse(["llama3.2:3b"]);
      if (url.endsWith("/api/chat")) return ndjsonResponse("hi from ollama");
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokens: string[] = [];
    const full = await streamChat("ollama", {
      systemPrompt: "sys",
      userPrompt: "user",
      onToken: (t) => tokens.push(t),
    });
    expect(full).toBe("hi from ollama");
    expect(tokens).toEqual(["hi from ollama"]);
  });

  it("throws when given a null backend", async () => {
    await expect(
      streamChat(null, {
        systemPrompt: "sys",
        userPrompt: "user",
        onToken: () => {},
      }),
    ).rejects.toThrow(/no backend selected/);
  });
});
