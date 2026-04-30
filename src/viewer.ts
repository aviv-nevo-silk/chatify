// Full-screen viewer for the live email currently open in the task pane.
// The task pane writes the current Conversation to localStorage; this page
// reads it and renders, then listens for storage events so the viewer
// auto-updates when the user navigates to a different email in Outlook.

import type { Conversation } from "./types.js";
import { renderConversation } from "./renderer.js";

const LIVE_KEY = "chatify.liveConversation";

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

function loadFromStorage(): Conversation | null {
  const raw = localStorage.getItem(LIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Conversation;
  } catch {
    return null;
  }
}

function render(): void {
  const root = $<HTMLElement>("chat-root");
  const conv = loadFromStorage();
  root.replaceChildren();

  if (!conv) {
    root.appendChild(buildEmptyState());
    setStatus("Waiting for the task pane…");
    document.title = "Chatify · Viewer";
    return;
  }

  renderConversation(conv, root);
  const bubbles = root.querySelectorAll(".row").length;
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

  // 1. Cross-tab storage events — fires when the task pane (or dev page)
  //    in another tab writes a new conversation.
  let lastSerialized = localStorage.getItem(LIVE_KEY);
  window.addEventListener("storage", (e) => {
    if (e.key !== LIVE_KEY) return;
    lastSerialized = e.newValue;
    render();
  });

  // 2. Polling fallback for ~10s after load. Storage events from Outlook's
  //    sandboxed iframe don't always reach a separate browser tab; poll
  //    catches the common case where the task pane writes localStorage
  //    shortly after this tab opens.
  let polls = 0;
  const interval = window.setInterval(() => {
    const current = localStorage.getItem(LIVE_KEY);
    if (current !== lastSerialized) {
      lastSerialized = current;
      render();
    }
    if (++polls >= 20) window.clearInterval(interval);
  }, 500);

  // 3. Re-render on tab focus, in case all of the above missed.
  window.addEventListener("focus", () => render());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
