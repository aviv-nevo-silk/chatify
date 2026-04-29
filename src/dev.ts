// Dev page entry. Picks a fixture from the dropdown (or `?fixture=` query
// param / localStorage on load), fetches it from `/tests/fixtures/<name>.json`,
// and feeds it into the renderer. Vite's `server.fs.allow: [".."]` lets the
// HTTP layer reach `tests/` even though it sits outside the web root.

import type { Conversation } from "./types.js";
import { renderConversation } from "./renderer.js";

const STORAGE_KEY = "chatify.lastFixture";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found in DOM`);
  return el as T;
}

function setStatus(text: string, isError = false): void {
  const status = $("dev-status");
  status.textContent = text;
  status.style.color = isError ? "#ff6b6b" : "";
}

async function loadFixture(name: string): Promise<void> {
  const root = $<HTMLElement>("chat-root");
  const url = `/tests/fixtures/${encodeURIComponent(name)}.json`;
  setStatus(`Loading ${name}…`);
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ${url}`);
    }
    const conv = (await res.json()) as Conversation;
    renderConversation(conv, root);
    const count = conv.messages.length;
    setStatus(`${count} message${count === 1 ? "" : "s"} · ${name}`);
    localStorage.setItem(STORAGE_KEY, name);
    syncUrl(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Error: ${message}`, true);
    root.replaceChildren();
  }
}

function syncUrl(name: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("fixture") === name) return;
  url.searchParams.set("fixture", name);
  window.history.replaceState({}, "", url.toString());
}

function pickInitialFixture(picker: HTMLSelectElement): string | null {
  // Priority: ?fixture= query param > localStorage > nothing.
  const params = new URLSearchParams(window.location.search);
  const queryName = params.get("fixture");
  if (queryName && hasOption(picker, queryName)) return queryName;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && hasOption(picker, stored)) return stored;

  return null;
}

function hasOption(picker: HTMLSelectElement, value: string): boolean {
  for (const opt of Array.from(picker.options)) {
    if (opt.value === value) return true;
  }
  return false;
}

function init(): void {
  const picker = $<HTMLSelectElement>("fixture-picker");

  picker.addEventListener("change", () => {
    const name = picker.value;
    if (!name) return;
    void loadFixture(name);
  });

  const initial = pickInitialFixture(picker);
  if (initial) {
    picker.value = initial;
    void loadFixture(initial);
  } else {
    setStatus("Pick a fixture above.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
