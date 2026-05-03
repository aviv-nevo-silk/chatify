import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isAiEnabled,
  mountAiUi,
  setAiEnabled,
} from "../../src/ai-summarize";
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

describe("ai-summarize.isAiEnabled / setAiEnabled", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to true when nothing is set", () => {
    expect(isAiEnabled()).toBe(true);
  });

  it("returns false only when explicitly set to 'false'", () => {
    localStorage.setItem("chatify.aiEnabled", "false");
    expect(isAiEnabled()).toBe(false);
  });

  it("any other value (including legacy 'true') still means enabled", () => {
    localStorage.setItem("chatify.aiEnabled", "true");
    expect(isAiEnabled()).toBe(true);
    localStorage.setItem("chatify.aiEnabled", "1");
    expect(isAiEnabled()).toBe(true);
  });

  it("setAiEnabled(false) writes 'false', setAiEnabled(true) clears the key", () => {
    setAiEnabled(false);
    expect(localStorage.getItem("chatify.aiEnabled")).toBe("false");
    setAiEnabled(true);
    expect(localStorage.getItem("chatify.aiEnabled")).toBeNull();
  });
});

describe("ai-summarize.mountAiUi", () => {
  beforeEach(() => {
    localStorage.clear();
    clearProbeCache();
    document.body.innerHTML = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).LanguageModel;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ai;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).LanguageModel;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).ai;
    document.querySelector(".ai-settings-drawer")?.remove();
  });

  it("always mounts the settings button regardless of state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const container = setupContainer();
    await mountAiUi(container);
    expect(
      container.querySelector(".ai-actions__settings"),
    ).not.toBeNull();
  });

  it("hides the chip when AI is disabled but keeps the settings button", async () => {
    localStorage.setItem("chatify.aiEnabled", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);
    expect(container.querySelector(".ai-actions__settings")).not.toBeNull();
    expect(container.querySelector(".ai-actions__chip")).toBeNull();
  });

  it("hides the chip when no backend is reachable but keeps the settings button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const container = setupContainer();
    await mountAiUi(container);
    expect(container.querySelector(".ai-actions__settings")).not.toBeNull();
    expect(container.querySelector(".ai-actions__chip")).toBeNull();
  });

  it("renders the Summarize chip when AI is on by default and a backend is ready", async () => {
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
  });

  it("inserts the AI UI right after the thread header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);
    const header = container.querySelector(".chat-thread-header");
    const actions = container.querySelector(".ai-actions");
    expect(header!.nextElementSibling).toBe(actions);
  });

  it("falls back to the first installed model when configured one is missing", async () => {
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

  it("clicking the Summarize chip streams a TL;DR into a card and hides the chip", async () => {
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
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const body = container.querySelector(".ai-summary-card__body");
    expect(body?.textContent).toContain("Lunch at noon");
    // Chip should be hidden once the card is rendered.
    expect(chip.style.display).toBe("none");
  });

  it("the regenerate button re-streams a fresh summary into the same card", async () => {
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
    const card = container.querySelector(".ai-summary-card")!;
    const regen = card.querySelectorAll(
      ".ai-summary-card__btn",
    )[0] as HTMLButtonElement;
    expect(regen.title).toBe("Regenerate summary");
    regen.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const cards = container.querySelectorAll(".ai-summary-card");
    expect(cards.length).toBe(1);
    expect(cards[0]!.querySelector(".ai-summary-card__body")?.textContent).toBe(
      "call-2",
    );
  });

  it("the dismiss button removes the card and brings the chip back", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) return tagsResponse(["llama3.2:3b"]);
      if (url.endsWith("/api/chat")) return chatStreamResponse("ok");
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
    const dismiss = container.querySelectorAll(
      ".ai-summary-card__btn",
    )[1] as HTMLButtonElement;
    expect(dismiss.title).toBe("Dismiss");
    dismiss.click();
    expect(container.querySelector(".ai-summary-card")).toBeNull();
    expect(chip.style.display).toBe("");
  });

  it("clicking the settings button opens a drawer with the toggle and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);
    const settings = container.querySelector(
      ".ai-actions__settings",
    ) as HTMLButtonElement;
    settings.click();
    // Drawer is appended to document.body, not to the container.
    const drawer = document.querySelector(".ai-settings-drawer");
    expect(drawer).not.toBeNull();
    const toggle = drawer!.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(true); // default state
    // Status fills async — give it a tick
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const status = drawer!.querySelector(".ai-settings-drawer__status-line");
    expect(status?.textContent).toContain("Ollama");
  });

  it("toggling the settings drawer off hides the chip in real time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(tagsResponse(["llama3.2:3b"])),
    );
    const container = setupContainer();
    await mountAiUi(container);
    expect(container.querySelector(".ai-actions__chip")).not.toBeNull();

    const settings = container.querySelector(
      ".ai-actions__settings",
    ) as HTMLButtonElement;
    settings.click();
    const drawer = document.querySelector(".ai-settings-drawer")!;
    const toggle = drawer.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    // mountAiUi runs async to re-render
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".ai-actions__chip")).toBeNull();
    expect(container.querySelector(".ai-actions__settings")).not.toBeNull();
  });

  it("clicking settings a second time toggles the drawer closed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const container = setupContainer();
    await mountAiUi(container);
    const settings = container.querySelector(
      ".ai-actions__settings",
    ) as HTMLButtonElement;
    settings.click();
    expect(document.querySelector(".ai-settings-drawer")).not.toBeNull();
    settings.click();
    expect(document.querySelector(".ai-settings-drawer")).toBeNull();
  });
});
