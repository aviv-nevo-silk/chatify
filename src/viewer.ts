// Full-screen viewer for the live email currently open in the task pane.
// The task pane writes the current Conversation to localStorage; this page
// reads it and renders, then listens for storage events so the viewer
// auto-updates when the user navigates to a different email in Outlook.

import type { Conversation } from "./types.js";
import { renderConversation } from "./renderer.js";

const LIVE_KEY = "chatify.liveConversation";
const CHANNEL_NAME = "chatify-live";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

function setStatus(text: string, isError = false): void {
  const status = $("dev-status");
  status.textContent = text;
  if (isError) status.dataset.state = "error";
  else delete status.dataset.state;
}

function loadFromUrlHash(): Conversation | null {
  // The taskpane.ts click handler embeds the conversation in the URL hash
  // (#data=<encoded json>) so we can bypass Chrome's Storage Partitioning,
  // which makes localStorage between the Outlook iframe and this tab live
  // in separate partitions.
  const hash = window.location.hash;
  if (!hash.startsWith("#data=")) return null;
  try {
    const json = decodeURIComponent(hash.slice("#data=".length));
    return JSON.parse(json) as Conversation;
  } catch {
    return null;
  }
}

function loadFromStorage(): Conversation | null {
  const raw = localStorage.getItem(LIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

function loadConversation(): Conversation | null {
  // URL hash takes priority — it's the authoritative source from the
  // taskpane that just opened this tab. localStorage is fallback for
  // legacy clients or same-partition scenarios.
  return loadFromUrlHash() ?? loadFromStorage();
}

function render(): void {
  const root = $<HTMLElement>("chat-root");
  const conv = loadConversation();
  root.replaceChildren();

  if (!conv) {
    root.appendChild(buildEmptyState());
    setStatus("Waiting for the task pane…");
    document.title = "Chatify · Viewer";
    return;
  }

  // Wrap the rendered chat in a centered slot so it horizontally centers
  // in the wide viewer. Without the wrapper, .chat-thread-header and .row
  // children have their own `margin: ... 0 ...` rules (specificity higher
  // than `.chat-root > * { margin: 0 auto }`) which zero out the auto
  // margins and pin the chat to the left edge in wide viewports.
  const slot = document.createElement("div");
  slot.className = "fixture-section__chat";
  root.appendChild(slot);

  renderConversation(conv, slot);
  const bubbles = slot.querySelectorAll(".row").length;
  setStatus(
    `${bubbles} bubble${bubbles === 1 ? "" : "s"} · live (auto-updates)`,
  );
  const subject = conv.messages[0]?.subject ?? "Chatify";
  document.title = `Chatify · ${subject}`;
}

function buildEmptyState(): HTMLElement {
  const empty = document.createElement("div");
  empty.style.padding = "32px";
  empty.style.color = "#8696a0";
  empty.style.lineHeight = "1.6";
  empty.style.maxWidth = "560px";
  empty.style.margin = "0 auto";
  empty.innerHTML = `
    <h2 style="color:#e9edef;font-weight:600;margin-bottom:8px;">No live email yet</h2>
    <p>Open an email in Outlook and click the <strong>Chatify</strong> task-pane button. This page will then mirror the chat at full browser width.</p>
    <p style="font-size:13px;margin-top:16px;">Tip: keep this tab open beside Outlook — it auto-updates when you switch messages.</p>
  `;
  return empty;
}

function init(): void {
  render();
  installRefreshButton();

  let lastSerialized = localStorage.getItem(LIVE_KEY);
  const refresh = (): void => {
    const current = localStorage.getItem(LIVE_KEY);
    if (current !== lastSerialized) {
      lastSerialized = current;
      render();
    }
  };

  // 1. BroadcastChannel — designed for same-origin cross-tab/iframe messages.
  //    More reliable than `storage` events when the writer is inside a
  //    sandboxed iframe (like Outlook's task pane).
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "live-update") {
        refresh();
      }
    });
  }

  // 2. Standard `storage` event (cross-tab, same origin).
  window.addEventListener("storage", (e) => {
    if (e.key === LIVE_KEY) refresh();
  });

  // 3. Permanent low-frequency poll. Belt-and-suspenders for the case where
  //    neither BroadcastChannel nor storage events fire from the iframe.
  //    1s × cheap getItem = negligible CPU.
  window.setInterval(refresh, 1000);

  // 4. Re-render whenever the user focuses this tab.
  window.addEventListener("focus", refresh);
}

function installRefreshButton(): void {
  const status = $("dev-status");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "↻ Refresh";
  btn.style.cssText =
    "background:transparent;border:1px solid rgba(37,211,102,0.4);color:#25d366;padding:4px 10px;border-radius:999px;cursor:pointer;font-size:11.5px;margin-left:10px;";
  btn.addEventListener("click", () => render());
  status.parentElement?.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
