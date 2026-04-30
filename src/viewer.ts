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
    root.appendChild(empty);
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

function init(): void {
  render();

  // When the task pane (in another tab) writes a new conversation, refresh.
  window.addEventListener("storage", (e) => {
    if (e.key === LIVE_KEY) render();
  });

  // Also re-render on tab focus, in case the storage event was missed.
  window.addEventListener("focus", () => render());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
