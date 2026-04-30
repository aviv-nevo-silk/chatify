import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  probeOllama,
  streamChat,
  clearProbeCache,
  getOllamaConfig,
} from "../../src/utils/ollama";

const TAGS_OK = {
  models: [
    { name: "llama3.2:3b" },
    { name: "qwen2.5:3b" },
  ],
};

function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(line));
      controller.close();
    },
  });
}

describe("ollama.probeOllama", () => {
  beforeEach(() => {
    localStorage.clear();
    clearProbeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns reachable=true and the model list when /api/tags responds 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(TAGS_OK), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeOllama({ force: true });
    expect(result.reachable).toBe(true);
    expect(result.models).toEqual(["llama3.2:3b", "qwen2.5:3b"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns reachable=false on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const result = await probeOllama({ force: true });
    expect(result.reachable).toBe(false);
    expect(result.models).toEqual([]);
  });

  it("returns reachable=false on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const result = await probeOllama({ force: true });
    expect(result.reachable).toBe(false);
  });

  it("caches the result so a second call doesn't re-fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TAGS_OK), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeOllama({ force: true });
    await probeOllama();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses the cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TAGS_OK), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeOllama({ force: true });
    await probeOllama({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clearProbeCache forces the next probe to re-fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TAGS_OK), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeOllama({ force: true });
    clearProbeCache();
    await probeOllama();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the host override from localStorage", async () => {
    localStorage.setItem("chatify.ollamaHost", "http://localhost:9999");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(TAGS_OK), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeOllama({ force: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9999/api/tags",
      expect.anything(),
    );
  });
});

describe("ollama.getOllamaConfig", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns defaults when no overrides are set", () => {
    expect(getOllamaConfig()).toEqual({
      host: "http://localhost:11434",
      model: "llama3.2:3b",
    });
  });

  it("respects host and model overrides", () => {
    localStorage.setItem("chatify.ollamaHost", "https://localhost:11435");
    localStorage.setItem("chatify.ollamaModel", "qwen2.5:3b");
    expect(getOllamaConfig()).toEqual({
      host: "https://localhost:11435",
      model: "qwen2.5:3b",
    });
  });
});

describe("ollama.streamChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses NDJSON lines and calls onToken for each content chunk", async () => {
    const ndjson = [
      JSON.stringify({ message: { content: "Hello" } }) + "\n",
      JSON.stringify({ message: { content: ", " } }) + "\n",
      JSON.stringify({ message: { content: "world!" } }) + "\n",
      JSON.stringify({ done: true }) + "\n",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNdjsonStream(ndjson), { status: 200 }),
      ),
    );
    const tokens: string[] = [];
    const full = await streamChat(
      { host: "http://localhost:11434", model: "llama3.2:3b" },
      [{ role: "user", content: "hi" }],
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["Hello", ", ", "world!"]);
    expect(full).toBe("Hello, world!");
  });

  it("handles a JSON object split across two chunks", async () => {
    const json = JSON.stringify({ message: { content: "split-token" } });
    const half1 = json.slice(0, 12);
    const half2 = json.slice(12) + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNdjsonStream([half1, half2]), { status: 200 }),
      ),
    );
    const tokens: string[] = [];
    const full = await streamChat(
      { host: "http://localhost:11434", model: "x" },
      [{ role: "user", content: "hi" }],
      (t) => tokens.push(t),
    );
    expect(full).toBe("split-token");
    expect(tokens).toEqual(["split-token"]);
  });

  it("skips malformed lines without throwing", async () => {
    const ndjson = [
      "this is not json\n",
      JSON.stringify({ message: { content: "ok" } }) + "\n",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(makeNdjsonStream(ndjson), { status: 200 }),
      ),
    );
    const tokens: string[] = [];
    await streamChat(
      { host: "http://localhost:11434", model: "x" },
      [{ role: "user", content: "hi" }],
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(["ok"]);
  });

  it("throws on non-2xx HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 500 })),
    );
    await expect(
      streamChat(
        { host: "http://localhost:11434", model: "x" },
        [{ role: "user", content: "hi" }],
        () => {},
      ),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("uses the configured host and POSTs the messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        makeNdjsonStream([
          JSON.stringify({ message: { content: "ok" } }) + "\n",
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await streamChat(
      { host: "https://localhost:11435", model: "qwen2.5:3b" },
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      () => {},
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://localhost:11435/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(2);
  });
});
