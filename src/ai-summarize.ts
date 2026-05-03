// AI Summarize integration. Adds a "🧠 Summarize" chip below the thread
// header. On click: collects the rendered conversation as plain text, sends
// it to whichever AI backend is available (browser-native window.ai first,
// Ollama on localhost second), streams the response into a card above the
// bubbles. If no backend is reachable, shows a small install banner with a
// Setup link instead.
//
// Gated behind the localStorage flag `chatify.aiEnabled === "true"` so the
// feature ships dark and only opted-in users see it.

import { clearProbeCache } from "./utils/ollama.js";
import {
  detectBackend,
  streamChat,
  type Backend,
} from "./utils/ai-backend.js";

const FEATURE_FLAG_KEY = "chatify.aiEnabled";
const SETUP_URL =
  "https://github.com/aviv-nevo-silk/chatify/blob/main/docs/AI_SETUP.md";

export function isAiEnabled(): boolean {
  try {
    return localStorage.getItem(FEATURE_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Mount AI UI inside `container` (which already contains a rendered
 * conversation). Inserts either a Summarize chip (a backend is ready) or
 * a setup banner (otherwise), placed right after the thread header.
 */
export async function mountAiUi(container: HTMLElement): Promise<void> {
  if (!isAiEnabled()) return;
  const info = await detectBackend();
  const wrap = document.createElement("div");
  wrap.className = "ai-actions";
  if (info.ready && info.backend) {
    wrap.appendChild(buildSummarizeChip(container, info.backend, info.label));
  } else {
    wrap.appendChild(buildSetupBanner(info.label));
  }
  insertAfterThreadHeader(container, wrap);
}

function insertAfterThreadHeader(
  container: HTMLElement,
  el: HTMLElement,
): void {
  const header = container.querySelector(".chat-thread-header");
  if (header && header.parentElement) {
    header.parentElement.insertBefore(el, header.nextSibling);
  } else {
    container.insertBefore(el, container.firstChild);
  }
}

function buildSummarizeChip(
  container: HTMLElement,
  backend: Backend,
  label: string,
): HTMLElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ai-actions__chip";
  chip.textContent = "🧠 Summarize";
  chip.title = `Summarize this thread using ${label}`;
  chip.addEventListener("click", () => {
    void runSummarize(container, backend, chip);
  });
  return chip;
}

function buildSetupBanner(statusLabel: string): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "ai-actions__banner";

  const text = document.createElement("span");
  text.className = "ai-actions__banner-text";
  // If the backend reported a "downloading" or other intermediate state,
  // show that. Otherwise fall back to the generic "AI summaries available"
  // message that points the user at setup.
  text.textContent =
    statusLabel.includes("download")
      ? `⏳ ${statusLabel}.`
      : "💡 AI summaries available — runs locally on your machine.";

  const link = document.createElement("a");
  link.className = "ai-actions__banner-link";
  link.href = SETUP_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Setup ↗";

  const recheck = document.createElement("button");
  recheck.type = "button";
  recheck.className = "ai-actions__banner-recheck";
  recheck.textContent = "Re-check";
  recheck.addEventListener("click", () => {
    clearProbeCache();
    location.reload();
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ai-actions__banner-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => banner.remove());

  banner.append(text, link, recheck, dismiss);
  return banner;
}

function buildSummaryCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "ai-summary-card";

  const title = document.createElement("div");
  title.className = "ai-summary-card__title";
  title.textContent = "🧠 TL;DR";

  const body = document.createElement("div");
  body.className = "ai-summary-card__body";

  card.append(title, body);
  return card;
}

async function runSummarize(
  container: HTMLElement,
  backend: Backend,
  chip: HTMLButtonElement,
): Promise<void> {
  chip.disabled = true;
  chip.textContent = "🧠 Summarizing…";

  const existing = container.querySelector(".ai-summary-card");
  if (existing) existing.remove();

  const card = buildSummaryCard();
  insertAfterThreadHeader(container, card);
  const body = card.querySelector(".ai-summary-card__body") as HTMLElement;

  const conversationText = collectConversationText(container);

  try {
    await streamChat(backend, {
      systemPrompt:
        "You summarize email threads concisely for a busy reader. " +
        "3–5 short bullet points. Lead with the most important takeaway. " +
        "Mention people by name when relevant. Skip disclaimers, " +
        "signatures, and meeting boilerplate. Output plain text — no " +
        "markdown headers, no preamble.",
      userPrompt: `Summarize this email thread:\n\n${conversationText}`,
      onToken: (token) => {
        body.textContent = (body.textContent ?? "") + token;
      },
    });
  } catch (err) {
    body.textContent = `[Failed: ${err instanceof Error ? err.message : String(err)}]`;
  } finally {
    chip.disabled = false;
    chip.textContent = "🧠 Summarize";
  }
}

function collectConversationText(container: HTMLElement): string {
  const lines: string[] = [];
  const subject = container.querySelector(
    ".chat-thread-header__title",
  )?.textContent;
  if (subject) lines.push(`Subject: ${subject.trim()}`);
  for (const row of Array.from(container.querySelectorAll(".row"))) {
    const senderEl = row.querySelector(".bubble__sender");
    const sender =
      senderEl?.textContent?.trim() ??
      (row.classList.contains("row--out") ? "(you)" : "Unknown");
    const time =
      row.querySelector(".bubble__meta")?.textContent?.trim() ?? "";
    const content = (
      row.querySelector(".bubble__content")?.textContent ?? ""
    ).trim();
    if (!content) continue;
    lines.push(`\n[${sender}${time ? " · " + time : ""}]\n${content}`);
  }
  return lines.join("\n");
}
