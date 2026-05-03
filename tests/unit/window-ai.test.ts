import { describe, it, expect, afterEach, vi } from "vitest";
import { probeWindowAi, streamChatWindowAi } from "../../src/utils/window-ai";

function makeStringStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).LanguageModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).ai;
});

describe("window-ai.probeWindowAi", () => {
  it("returns ready when LanguageModel.availability() resolves to 'available'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("available"),
    };
    const result = await probeWindowAi();
    expect(result).toEqual({ available: true, status: "ready" });
  });

  it("returns ready for 'readily' (older API vocabulary)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("readily"),
    };
    expect(await probeWindowAi()).toEqual({ available: true, status: "ready" });
  });

  it("returns downloading for 'after-download' / 'downloadable'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("after-download"),
    };
    expect(await probeWindowAi()).toEqual({
      available: true,
      status: "downloading",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
    };
    expect(await probeWindowAi()).toEqual({
      available: true,
      status: "downloading",
    });
  });

  it("returns unavailable for 'no' / unknown values / missing API", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      availability: vi.fn().mockResolvedValue("no"),
    };
    expect(await probeWindowAi()).toEqual({
      available: false,
      status: "unavailable",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).LanguageModel;
    expect(await probeWindowAi()).toEqual({
      available: false,
      status: "unavailable",
    });
  });

  it("falls back to window.ai.languageModel.availability()", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ai = {
      languageModel: {
        availability: vi.fn().mockResolvedValue("available"),
      },
    };
    expect(await probeWindowAi()).toEqual({ available: true, status: "ready" });
  });

  it("falls back to window.ai.canCreateTextSession() (oldest API)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ai = {
      canCreateTextSession: vi.fn().mockResolvedValue("readily"),
    };
    expect(await probeWindowAi()).toEqual({ available: true, status: "ready" });
  });
});

describe("window-ai.streamChatWindowAi", () => {
  it("streams cumulative chunks correctly (newer API delta-from-prefix)", async () => {
    const session = {
      promptStreaming: vi
        .fn()
        .mockReturnValue(
          makeStringStream(["Hello", "Hello, ", "Hello, world"]),
        ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      create: vi.fn().mockResolvedValue(session),
    };

    const tokens: string[] = [];
    const full = await streamChatWindowAi("sys", "user", (t) => tokens.push(t));
    expect(tokens).toEqual(["Hello", ", ", "world"]);
    expect(full).toBe("Hello, world");
  });

  it("streams delta-style chunks correctly (older API)", async () => {
    const session = {
      promptStreaming: vi
        .fn()
        .mockReturnValue(makeStringStream(["foo ", "bar ", "baz"])),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).LanguageModel = {
      create: vi.fn().mockResolvedValue(session),
    };

    const tokens: string[] = [];
    const full = await streamChatWindowAi("sys", "user", (t) => tokens.push(t));
    expect(tokens).toEqual(["foo ", "bar ", "baz"]);
    expect(full).toBe("foo bar baz");
  });

  it("throws when no compatible API is available", async () => {
    await expect(streamChatWindowAi("sys", "user", () => {})).rejects.toThrow(
      /no compatible API/,
    );
  });

  it("uses window.ai.languageModel.create when LanguageModel global is missing", async () => {
    const create = vi.fn().mockResolvedValue({
      promptStreaming: () => makeStringStream(["ok"]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ai = { languageModel: { create } };

    const tokens: string[] = [];
    await streamChatWindowAi("sys", "user prompt", (t) => tokens.push(t));
    expect(create).toHaveBeenCalledWith({ systemPrompt: "sys" });
    expect(tokens).toEqual(["ok"]);
  });

  it("uses window.ai.createTextSession as a final fallback", async () => {
    const createTextSession = vi.fn().mockResolvedValue({
      promptStreaming: () => makeStringStream(["legacy"]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ai = { createTextSession };

    const tokens: string[] = [];
    await streamChatWindowAi("sys", "user", (t) => tokens.push(t));
    expect(createTextSession).toHaveBeenCalledWith({ systemPrompt: "sys" });
    expect(tokens).toEqual(["legacy"]);
  });
});
