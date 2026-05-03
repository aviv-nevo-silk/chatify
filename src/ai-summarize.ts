// AI Summarize integration. Adds a "🧠 Summarize" chip below the thread
// header when an AI backend is reachable, plus a small "⚙ AI" settings
// button that's always visible. The settings drawer lets users toggle the
// feature, see backend status, and find the setup guide — replaces the
// localStorage-only opt-in flag we used during dark-launch.
//
// Default state: AI features are ON for everyone. The chip simply doesn't
// render if no backend is reachable, so non-AI users see nothing extra
// beyond the small settings cog.

import { clearProbeCache } from "./utils/ollama.js";
import {
  detectBackend,
  streamChat,
  type Backend,
} from "./utils/ai-backend.js";

const FEATURE_FLAG_KEY = "chatify.aiEnabled";
const SETUP_URL =
  "https://github.com/aviv-nevo-silk/chatify/blob/main/docs/AI_SETUP.md";

/**
 * AI features are ON by default. Returns false ONLY when the user has
 * explicitly disabled them via the settings drawer.
 */
export function isAiEnabled(): boolean {
  try {
    return localStorage.getItem(FEATURE_FLAG_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setAiEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.removeItem(FEATURE_FLAG_KEY);
    } else {
      localStorage.setItem(FEATURE_FLAG_KEY, "false");
    }
  } catch {
    // localStorage may be disabled — silently no-op.
  }
}

/**
 * Mount AI UI inside `container` (which already contains a rendered
 * conversation). Always appends the small settings cog. Adds the
 * Summarize chip alongside it iff AI is enabled and a backend is ready.
 */
export async function mountAiUi(container: HTMLElement): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "ai-actions";

  // Always-visible settings cog. Click → drawer with toggle + status +
  // setup link. This is the discoverability surface for users who don't
  // yet have AI set up.
  wrap.appendChild(buildSettingsButton(container));

  // Chip is conditional on the toggle + backend availability.
  if (isAiEnabled()) {
    const info = await detectBackend();
    if (info.ready && info.backend) {
      wrap.appendChild(
        buildSummarizeChip(container, info.backend, info.label),
      );
    }
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

function buildSettingsButton(container: HTMLElement): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ai-actions__settings";
  btn.textContent = "⚙ AI";
  btn.title = "AI summary settings";
  btn.addEventListener("click", () => {
    void openSettingsDrawer(container, btn);
  });
  return btn;
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

async function openSettingsDrawer(
  container: HTMLElement,
  trigger: HTMLElement,
): Promise<void> {
  // Close any existing drawer (toggle behavior on second click).
  const existing = document.querySelector(".ai-settings-drawer");
  if (existing) {
    existing.remove();
    return;
  }

  const drawer = document.createElement("div");
  drawer.className = "ai-settings-drawer";

  const title = document.createElement("div");
  title.className = "ai-settings-drawer__title";
  title.textContent = "AI summaries";
  drawer.appendChild(title);

  // Toggle.
  const toggleRow = document.createElement("label");
  toggleRow.className = "ai-settings-drawer__row";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = isAiEnabled();
  toggle.addEventListener("change", () => {
    setAiEnabled(toggle.checked);
    // Re-mount so the chip appears/disappears in real time.
    rerenderAiActions(container);
    // Refresh the drawer's status section too.
    void refreshStatus(statusContainer);
  });
  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "Enable AI summaries";
  toggleRow.append(toggle, toggleLabel);
  drawer.appendChild(toggleRow);

  // Status (filled async).
  const statusContainer = document.createElement("div");
  statusContainer.className = "ai-settings-drawer__status";
  drawer.appendChild(statusContainer);
  void refreshStatus(statusContainer);

  // Footer: setup link + re-check + close.
  const footer = document.createElement("div");
  footer.className = "ai-settings-drawer__footer";

  const link = document.createElement("a");
  link.className = "ai-settings-drawer__link";
  link.href = SETUP_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Setup guide ↗";
  footer.appendChild(link);

  const recheck = document.createElement("button");
  recheck.type = "button";
  recheck.className = "ai-settings-drawer__btn";
  recheck.textContent = "Re-check";
  recheck.addEventListener("click", async () => {
    clearProbeCache();
    await refreshStatus(statusContainer);
    rerenderAiActions(container);
  });
  footer.appendChild(recheck);

  drawer.appendChild(footer);

  // Position the drawer below the trigger button.
  const rect = trigger.getBoundingClientRect();
  drawer.style.top = `${rect.bottom + window.scrollY + 6}px`;
  drawer.style.left = `${rect.left + window.scrollX}px`;

  document.body.appendChild(drawer);

  // Close on outside click.
  const closeOnOutside = (e: MouseEvent) => {
    if (!drawer.contains(e.target as Node) && e.target !== trigger) {
      drawer.remove();
      document.removeEventListener("mousedown", closeOnOutside);
    }
  };
  // Defer attaching the listener to skip the click that opened the drawer.
  setTimeout(() => document.addEventListener("mousedown", closeOnOutside), 0);
}

async function refreshStatus(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  if (!isAiEnabled()) {
    const off = document.createElement("div");
    off.className = "ai-settings-drawer__status-line";
    off.textContent = "Disabled.";
    host.appendChild(off);
    return;
  }
  const loading = document.createElement("div");
  loading.className = "ai-settings-drawer__status-line";
  loading.textContent = "Checking…";
  host.appendChild(loading);

  const info = await detectBackend();
  host.replaceChildren();

  const line = document.createElement("div");
  line.className = "ai-settings-drawer__status-line";
  if (info.ready && info.backend) {
    line.textContent = `✓ ${info.label}`;
    line.dataset.state = "ready";
  } else if (info.label.includes("download")) {
    line.textContent = `⏳ ${info.label}`;
    line.dataset.state = "pending";
  } else {
    line.textContent = `✗ ${info.label}`;
    line.dataset.state = "off";
    const hint = document.createElement("div");
    hint.className = "ai-settings-drawer__status-hint";
    hint.textContent =
      "Try enabling Chrome's Prompt API at chrome://flags, or install Ollama at localhost:11434.";
    host.appendChild(line);
    host.appendChild(hint);
    return;
  }
  host.appendChild(line);
}

function rerenderAiActions(container: HTMLElement): void {
  const existing = container.querySelector(".ai-actions");
  if (existing) existing.remove();
  void mountAiUi(container);
}

function buildSummaryCard(
  container: HTMLElement,
  backend: Backend,
  chip: HTMLButtonElement,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "ai-summary-card";

  const header = document.createElement("div");
  header.className = "ai-summary-card__header";

  const title = document.createElement("div");
  title.className = "ai-summary-card__title";
  title.textContent = "🧠 TL;DR";
  header.appendChild(title);

  // Right-aligned actions: regenerate + dismiss.
  const actions = document.createElement("div");
  actions.className = "ai-summary-card__actions";

  const regen = document.createElement("button");
  regen.type = "button";
  regen.className = "ai-summary-card__btn";
  regen.textContent = "↻";
  regen.title = "Regenerate summary";
  regen.addEventListener("click", () => {
    void streamIntoCard(card, container, backend);
  });
  actions.appendChild(regen);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ai-summary-card__btn";
  dismiss.textContent = "×";
  dismiss.title = "Dismiss";
  dismiss.setAttribute("aria-label", "Dismiss summary");
  dismiss.addEventListener("click", () => {
    card.remove();
    chip.style.display = "";
  });
  actions.appendChild(dismiss);

  header.appendChild(actions);
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "ai-summary-card__body";
  card.appendChild(body);

  return card;
}

async function streamIntoCard(
  card: HTMLElement,
  container: HTMLElement,
  backend: Backend,
): Promise<void> {
  const body = card.querySelector(".ai-summary-card__body") as HTMLElement;
  body.textContent = "";

  const regenBtn = card.querySelector(
    ".ai-summary-card__actions .ai-summary-card__btn",
  ) as HTMLButtonElement | null;
  if (regenBtn) {
    regenBtn.disabled = true;
    regenBtn.textContent = "…";
  }

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
    if (regenBtn) {
      regenBtn.disabled = false;
      regenBtn.textContent = "↻";
    }
  }
}

async function runSummarize(
  container: HTMLElement,
  backend: Backend,
  chip: HTMLButtonElement,
): Promise<void> {
  // Once the user kicks off a summary the chip is meaningless until they
  // dismiss the card — hide it and let the card own further interactions
  // (regenerate via ↻, dismiss via ×).
  chip.style.display = "none";

  const existing = container.querySelector(".ai-summary-card");
  if (existing) existing.remove();

  const card = buildSummaryCard(container, backend, chip);
  insertAfterThreadHeader(container, card);

  await streamIntoCard(card, container, backend);
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
