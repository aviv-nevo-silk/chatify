import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isAiEnabled, mountAiUi } from "../../src/ai-summarize";
import { renderConversation } from "../../src/renderer";
import { clearProbeCache } from "../../src/utils/ollama";
import type { Conversation } from "../../src/types";

const tagsResponse = (models: string[]) =>
  new Response(JSON.stringify({ models: models.map((n) => ({ name: n })) }), {
    status: 200,
  });

function chatStreamResponse(text: string): Response {
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

const SAMPLE_CONVERSATION: Conversation = {
  conversationId: "ai-test-1",
  currentUser: { name: "Tester", address: "tester@example.com" },
  messages: [
    {
      id: "m1",
      conversationId: "ai-test-1",
      subject: "Lunch?",
      sender: { name: "Alex", address: "alex@example.com" },
      toRecipients: [{ name: "Tester", address: "tester@example.com" }],
      ccRecipients: [],
      sentDateTime: "2026-04-22T12:00:00.000Z",
      receivedDateTime: "2026-04-22T12:00:01.000Z",
      hasAttachments: false,
      attachments: [],
      body: { contentType: "html", content: "<p>Want lunch at noon?</p>" },
    },
  ],
};

function setupContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderConversation(SAMPLE_CONVERSATION, container);
  return container;
}

describe("ai-summarize.isAiEnabled", () => {
  beforeEach(() => localStorage.clear());

  it("returns false by default", () => {
    expect(isAiEnabled()).toBe(false);
  });

  it("returns true when chatify.aiEnabled === 'true'", () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    expect(isAiEnabled()).toBe(true);
  });

  it("returns false for any other value", () => {
    localStorage.setItem("chatify.aiEnabled", "1");
    expect(isAiEnabled()).toBe(false);
  });
});

describe("ai-summarize.mountAiUi", () => {
  beforeEach(() => {
    localStorage.clear();
    clearProbeCache();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when the feature flag is off", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const container = setupContainer();
    await mountAiUi(container);
    expect(container.querySelector(".ai-actions")).toBeNull();
  });

  it("renders a setup banner when Ollama is unreachable", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network")),
    );
    const container = setupContainer();
    await mountAiUi(container);

    const banner = container.querySelector(".ai-actions__banner");
    expect(banner).not.toBeNull();
    expect(container.querySelector(".ai-actions__chip")).toBeNull();

    const link = container.querySelector(".ai-actions__banner-link");
    expect(link?.getAttribute("href")).toMatch(/AI_SETUP\.md$/);
  });

  it("renders a setup banner when reachable but no models are installed", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse([])),
    );
    const container = setupContainer();
    await mountAiUi(container);

    expect(container.querySelector(".ai-actions__banner")).not.toBeNull();
    expect(container.querySelector(".ai-actions__chip")).toBeNull();
  });

  it("renders the Summarize chip when reachable with at least one model", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);

    const chip = container.querySelector(
      ".ai-actions__chip",
    ) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("Summarize");
    expect(container.querySelector(".ai-actions__banner")).toBeNull();
  });

  it("inserts the AI UI right after the thread header", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);

    const header = container.querySelector(".chat-thread-header");
    const actions = container.querySelector(".ai-actions");
    expect(header).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(header!.nextElementSibling).toBe(actions);
  });

  it("falls back to the first installed model when configured one is missing", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    localStorage.setItem("chatify.ollamaModel", "not-installed:42b");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["qwen2.5:3b", "phi3.5:3.8b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);

    const chip = container.querySelector(
      ".ai-actions__chip",
    ) as HTMLButtonElement;
    expect(chip.title).toContain("qwen2.5:3b");
  });

  it("clicking the Summarize chip streams a TL;DR into a card", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) return tagsResponse(["llama3.2:3b"]);
      if (url.endsWith("/api/chat"))
        return chatStreamResponse("• Lunch at noon. • Confirm soon.");
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = setupContainer();
    await mountAiUi(container);

    const chip = container.querySelector(
      ".ai-actions__chip",
    ) as HTMLButtonElement;
    chip.click();

    // Wait one microtask tick for the click handler's async work to complete.
    // The handler reads the stream, which resolves synchronously here because
    // our ReadableStream pushes both chunks before close.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const card = container.querySelector(".ai-summary-card");
    expect(card).not.toBeNull();
    const body = card!.querySelector(".ai-summary-card__body");
    expect(body?.textContent).toContain("Lunch at noon");
  });

  it("clicking again replaces the previous summary card instead of stacking", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");

    let callCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) return tagsResponse(["llama3.2:3b"]);
      if (url.endsWith("/api/chat")) {
        callCount += 1;
        return chatStreamResponse(`call-${callCount}`);
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = setupContainer();
    await mountAiUi(container);
    const chip = container.querySelector(
      ".ai-actions__chip",
    ) as HTMLButtonElement;

    chip.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    chip.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const cards = container.querySelectorAll(".ai-summary-card");
    expect(cards.length).toBe(1);
    expect(cards[0]!.textContent).toContain("call-2");
  });

  it("dismissing the banner removes it from the DOM", async () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const container = setupContainer();
    await mountAiUi(container);

    const banner = container.querySelector(".ai-actions__banner");
    expect(banner).not.toBeNull();
    const dismiss = banner!.querySelector(
      ".ai-actions__banner-dismiss",
    ) as HTMLButtonElement;
    dismiss.click();
    expect(container.querySelector(".ai-actions__banner")).toBeNull();
  });
});
