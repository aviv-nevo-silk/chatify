// AI features for Chatify. Adds a settings cog plus one chip per supported
// "action" (currently summarize + asks-of-you) below the thread header.
// All actions share the same plumbing: click the chip → chip hides, a card
// appears, the AI streams into the card. Each card has ↻ (regenerate) and
// × (dismiss) controls.
//
// Default state: AI is ON for everyone. The chips simply don't render if
// no backend is reachable, so non-AI users see nothing extra beyond the
// small settings cog.

import { clearProbeCache } from "./utils/ollama.js";
import {
  detectBackend,
  streamChat,
  getBackendPreference,
  setBackendPreference,
  type Backend,
  type BackendPreference,
} from "./utils/ai-backend.js";
import { renderMarkdown } from "./utils/markdown.js";

const FEATURE_FLAG_KEY = "chatify.aiEnabled";
const SETUP_URL =
  "https://github.com/aviv-nevo-silk/chatify/blob/main/docs/AI_SETUP.md";

// Each AI action gets a chip + card. Adding a new feature (translate,
// Q&A, etc.) means appending one entry here — no changes to mount, run,
// stream, or dismiss code paths.
type AiAction = "summarize" | "asks";

interface ActionConfig {
  /** Text on the chip button. */
  chipLabel: string;
  /** Tooltip on the chip; receives the backend's friendly name. */
  chipTitle: (backendLabel: string) => string;
  /** Header text inside the card. */
  cardTitle: string;
  /** System prompt sent to the LLM. */
  systemPrompt: string;
  /** User prompt; receives the rendered conversation text + current-user name. */
  buildUserPrompt: (conversationText: string, currentUserName: string) => string;
}

const ACTIONS: Record<AiAction, ActionConfig> = {
  summarize: {
    chipLabel: "🧠 Summarize",
    chipTitle: (label) => `Summarize this thread using ${label}`,
    cardTitle: "🧠 TL;DR",
    systemPrompt:
      "You summarize email threads concisely for a busy reader. " +
      "3–5 short bullet points. Lead with the most important takeaway. " +
      "Mention people by name when relevant. Skip disclaimers, " +
      "signatures, and meeting boilerplate. Output plain text — no " +
      "markdown headers, no preamble.",
    buildUserPrompt: (text) => `Summarize this email thread:\n\n${text}`,
  },
  asks: {
    chipLabel: "📋 My action items",
    chipTitle: (label) =>
      `Find action items addressed to you using ${label}`,
    cardTitle: "📋 My action items",
    systemPrompt:
      "You extract action items from email threads — specifically what " +
      "is being asked of one named user. Output: a short bulleted list " +
      "of things THAT USER specifically needs to do, decide, reply to, " +
      "or hit a deadline on. Each bullet: the action, who asked (if " +
      "relevant), and the deadline if mentioned. If nothing is asked of " +
      "this user, output exactly: 'Nothing for you to do.' Skip " +
      "disclaimers, signatures, and meeting boilerplate. Output plain " +
      "text — no markdown headers, no preamble.",
    buildUserPrompt: (text, user) =>
      `The user's name is "${user}". Find what is specifically being ` +
      `asked of them in this email thread:\n\n${text}`,
  },
};

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
 * conversation). Always appends the small settings cog. Adds one chip
 * per AI action iff the feature is enabled and a backend is ready.
 */
export async function mountAiUi(container: HTMLElement): Promise<void> {
  const wrap = document.createElement("div");
  wrap.className = "ai-actions";

  // Always-visible settings cog. Click → drawer with toggle + status +
  // setup link. This is the discoverability surface for users who don't
  // yet have AI set up.
  wrap.appendChild(buildSettingsButton(container));

  if (isAiEnabled()) {
    const info = await detectBackend();
    if (info.ready && info.backend) {
      for (const action of Object.keys(ACTIONS) as AiAction[]) {
        wrap.appendChild(
          buildAiChip(container, info.backend, info.label, action),
        );
      }
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

function buildAiChip(
  container: HTMLElement,
  backend: Backend,
  backendLabel: string,
  action: AiAction,
): HTMLElement {
  const cfg = ACTIONS[action];
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ai-actions__chip";
  chip.dataset.action = action;
  chip.textContent = cfg.chipLabel;
  chip.title = cfg.chipTitle(backendLabel);
  chip.addEventListener("click", () => {
    void runAiAction(container, backend, chip, action);
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
  title.textContent = "AI features";
  drawer.appendChild(title);

  // Toggle.
  const toggleRow = document.createElement("label");
  toggleRow.className = "ai-settings-drawer__row";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = isAiEnabled();
  toggle.addEventListener("change", () => {
    setAiEnabled(toggle.checked);
    rerenderAiActions(container);
    void refreshStatus(statusContainer);
  });
  const toggleLabel = document.createElement("span");
  toggleLabel.textContent = "Enable AI features";
  toggleRow.append(toggle, toggleLabel);
  drawer.appendChild(toggleRow);

  // Backend preference selector.
  const backendRow = document.createElement("label");
  backendRow.className = "ai-settings-drawer__row ai-settings-drawer__row--select";
  const backendLabel = document.createElement("span");
  backendLabel.textContent = "Backend";
  const backendSelect = document.createElement("select");
  backendSelect.className = "ai-settings-drawer__select";
  for (const [value, label] of [
    ["auto", "Auto (prefer Browser AI)"],
    ["window-ai", "Browser AI (Gemini Nano)"],
    ["ollama", "Ollama (localhost)"],
  ] as Array<[BackendPreference, string]>) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    backendSelect.appendChild(opt);
  }
  backendSelect.value = getBackendPreference();
  backendSelect.addEventListener("change", () => {
    setBackendPreference(backendSelect.value as BackendPreference);
    rerenderAiActions(container);
    void refreshStatus(statusContainer);
  });
  backendRow.append(backendLabel, backendSelect);
  drawer.appendChild(backendRow);

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

  const closeOnOutside = (e: MouseEvent) => {
    if (!drawer.contains(e.target as Node) && e.target !== trigger) {
      drawer.remove();
      document.removeEventListener("mousedown", closeOnOutside);
    }
  };
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

function buildAiCard(
  container: HTMLElement,
  backend: Backend,
  chip: HTMLButtonElement,
  action: AiAction,
): HTMLElement {
  const cfg = ACTIONS[action];
  const card = document.createElement("div");
  card.className = "ai-summary-card";
  card.dataset.action = action;

  const header = document.createElement("div");
  header.className = "ai-summary-card__header";

  const title = document.createElement("div");
  title.className = "ai-summary-card__title";
  title.textContent = cfg.cardTitle;
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "ai-summary-card__actions";

  const regen = document.createElement("button");
  regen.type = "button";
  regen.className = "ai-summary-card__btn";
  regen.textContent = "↻";
  regen.title = "Regenerate";
  regen.addEventListener("click", () => {
    void streamIntoCard(card, container, backend, action);
  });
  actions.appendChild(regen);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ai-summary-card__btn";
  dismiss.textContent = "×";
  dismiss.title = "Dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
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
  action: AiAction,
): Promise<void> {
  const cfg = ACTIONS[action];
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
  const currentUser = readCurrentUserName(container);

  // Buffer the streamed text and re-render the body as markdown after each
  // token. Cheap for summary-sized output and avoids the user seeing raw
  // ** ** / * ... markup before the model finishes.
  let buffer = "";

  try {
    await streamChat(backend, {
      systemPrompt: cfg.systemPrompt,
      userPrompt: cfg.buildUserPrompt(conversationText, currentUser),
      onToken: (token) => {
        buffer += token;
        body.innerHTML = renderMarkdown(buffer);
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

async function runAiAction(
  container: HTMLElement,
  backend: Backend,
  chip: HTMLButtonElement,
  action: AiAction,
): Promise<void> {
  // Hide the chip while its card is showing — meaningful action while a
  // card exists belongs to the card (regenerate/dismiss), not the chip.
  chip.style.display = "none";

  // Remove any existing card OF THIS ACTION (other actions' cards stay).
  const existing = container.querySelector(
    `.ai-summary-card[data-action="${action}"]`,
  );
  if (existing) existing.remove();

  const card = buildAiCard(container, backend, chip, action);
  insertAfterThreadHeader(container, card);

  await streamIntoCard(card, container, backend, action);
}

function readCurrentUserName(container: HTMLElement): string {
  const header = container.querySelector(".chat-thread-header") as
    | HTMLElement
    | null;
  return header?.dataset.currentUserName?.trim() || "the user";
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
