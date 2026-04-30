// AI Summarize integration. Adds a "🧠 Summarize" chip below the thread
// header. On click: collects the rendered conversation as plain text, sends
// it to the user's local Ollama instance, streams the response into a card
// above the bubbles. If Ollama isn't reachable, shows a small install banner
// with a Setup link instead.
//
// Gated behind the localStorage flag `chatify.aiEnabled === "true"` so the
// feature ships dark and only power users see it.

import {
  probeOllama,
  streamChat,
  clearProbeCache,
  getOllamaConfig,
} from "./utils/ollama.js";

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
 * conversation). Inserts either a Summarize chip (Ollama reachable, model
 * present) or a setup banner (otherwise), placed right after the thread
 * header so it appears in the same slot as the "Open full screen" link.
 */
export async function mountAiUi(container: HTMLElement): Promise<void> {
  if (!isAiEnabled()) return;
  const probe = await probeOllama();
  const wrap = document.createElement("div");
  wrap.className = "ai-actions";
  if (probe.reachable && probe.models.length > 0) {
    const cfg = getOllamaConfig();
    // Use the override model if installed; otherwise fall back to the first
    // available model. Avoids "model not found" errors if the user pulled
    // something other than the default.
    const model = probe.models.includes(cfg.model)
      ? cfg.model
      : probe.models[0]!;
    wrap.appendChild(buildSummarizeChip(container, model));
  } else {
    wrap.appendChild(buildSetupBanner());
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
  model: string,
): HTMLElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ai-actions__chip";
  chip.textContent = "🧠 Summarize";
  chip.title = `Summarize this thread using local model: ${model}`;
  chip.addEventListener("click", () => {
    void runSummarize(container, model, chip);
  });
  return chip;
}

function buildSetupBanner(): HTMLElement {
  const banner = document.createElement("div");
  banner.className = "ai-actions__banner";

  const text = document.createElement("span");
  text.className = "ai-actions__banner-text";
  text.textContent = "💡 AI summaries available — runs locally on your machine.";

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
  model: string,
  chip: HTMLButtonElement,
): Promise<void> {
  chip.disabled = true;
  chip.textContent = "🧠 Summarizing…";

  // If a previous run left a card, replace it instead of stacking.
  const existing = container.querySelector(".ai-summary-card");
  if (existing) existing.remove();

  const card = buildSummaryCard();
  insertAfterThreadHeader(container, card);
  const body = card.querySelector(".ai-summary-card__body") as HTMLElement;

  const conversationText = collectConversationText(container);
  const cfg = { ...getOllamaConfig(), model };

  try {
    await streamChat(
      cfg,
      [
        {
          role: "system",
          content:
            "You summarize email threads concisely for a busy reader. " +
            "3–5 short bullet points. Lead with the most important " +
            "takeaway. Mention people by name when relevant. Skip " +
            "disclaimers, signatures, and meeting boilerplate. Output " +
            "plain text — no markdown headers, no preamble.",
        },
        {
          role: "user",
          content: `Summarize this email thread:\n\n${conversationText}`,
        },
      ],
      (token) => {
        body.textContent = (body.textContent ?? "") + token;
      },
    );
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
