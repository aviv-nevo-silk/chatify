// Dev page entry. Picks a fixture from the dropdown (or `?fixture=` query
// param / localStorage on load), fetches it from `/tests/fixtures/<name>.json`,
// and feeds it into the renderer.
//
// Special value "__all__" renders every fixture in the dropdown stacked,
// each preceded by a section header — useful for visual review.

import type { Conversation } from "./types.js";
import { renderConversation } from "./renderer.js";

const STORAGE_KEY = "chatify.lastFixture";
const LIVE_KEY = "chatify.liveConversation";
const ALL_VALUE = "__all__";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found in DOM`);
  return el as T;
}

function setStatus(text: string, isError = false): void {
  const status = $("dev-status");
  status.textContent = text;
  if (isError) status.dataset.state = "error";
  else delete status.dataset.state;
}

function fixtureUrl(name: string): string {
  return `/tests/fixtures/${name}.json`;
}

async function fetchFixture(name: string): Promise<Conversation> {
  const res = await fetch(fixtureUrl(name), { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} loading ${name}`);
  }
  return (await res.json()) as Conversation;
}

function buildSectionHeader(label: string, conv: Conversation): HTMLElement {
  const header = document.createElement("div");
  header.className = "fixture-section";
  const title = document.createElement("div");
  title.className = "fixture-section__title";
  title.textContent = label;
  const sub = document.createElement("div");
  sub.className = "fixture-section__sub";
  // Sub text is set later (post-render) once we know the actual bubble count.
  sub.textContent = `as ${conv.currentUser.name}`;
  header.appendChild(title);
  header.appendChild(sub);
  if (conv.description) {
    const desc = document.createElement("div");
    desc.className = "fixture-section__desc";
    desc.textContent = conv.description;
    header.appendChild(desc);
  }
  return header;
}

function buildViewerLink(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "taskpane-actions";
  const link = document.createElement("a");
  link.className = "taskpane-actions__viewer";
  link.href = "/viewer.html";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "↗ Open full screen";
  wrap.appendChild(link);
  return wrap;
}

function describeRenderedCounts(conv: Conversation, slot: HTMLElement): string {
  const bubbles = slot.querySelectorAll(".row").length;
  const original = conv.messages.length;
  const bubbleLabel = `${bubbles} bubble${bubbles === 1 ? "" : "s"}`;
  // Show the Graph-message count when expansion happened (forwarded chains).
  const expansionTag =
    bubbles > original ? ` · expanded from ${original} email${original === 1 ? "" : "s"}` : "";
  return `${bubbleLabel}${expansionTag} · as ${conv.currentUser.name}`;
}

async function loadFixture(name: string): Promise<void> {
  const root = $<HTMLElement>("chat-root");
  setStatus(`Loading ${name}…`);
  try {
    if (name === ALL_VALUE) {
      await renderAll(root);
      return;
    }
    const conv = await fetchFixture(name);
    root.replaceChildren();

    // Wrap single-fixture views in the same .fixture-section header + chat
    // slot that the All-Fixtures view uses, so bubbles feel anchored within
    // a centered card instead of drifting against the left edge of an
    // unframed wide container.
    const picker = $<HTMLSelectElement>("fixture-picker");
    const labelOpt = Array.from(picker.options).find((o) => o.value === name);
    const label = labelOpt?.textContent?.trim() ?? name;
    const sectionHeader = buildSectionHeader(label, conv);
    root.appendChild(sectionHeader);

    // Mirror this fixture as the "live" conversation so the viewer.html tab
    // can render it. Same key the live taskpane.ts writes to. Plus
    // BroadcastChannel ping for any open viewer tab.
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify(conv));
    } catch {
      // localStorage may be disabled; the in-page render still works.
    }
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const ch = new BroadcastChannel("chatify-live");
        ch.postMessage({ type: "live-update" });
        ch.close();
      } catch {
        // ignore
      }
    }

    const slot = document.createElement("div");
    slot.className = "fixture-section__chat";
    root.appendChild(slot);
    renderConversation(conv, slot);

    // Place the "Open full screen" link directly under the thread header,
    // before the bubbles — same pattern as the live task pane.
    const header = slot.querySelector(".chat-thread-header");
    const link = buildViewerLink();
    if (header && header.parentElement) {
      header.parentElement.insertBefore(link, header.nextSibling);
    } else {
      slot.insertBefore(link, slot.firstChild);
    }

    const sub = sectionHeader.querySelector(".fixture-section__sub");
    if (sub) sub.textContent = describeRenderedCounts(conv, slot);

    const bubbles = slot.querySelectorAll(".row").length;
    const original = conv.messages.length;
    const expansionTag =
      bubbles > original ? ` (expanded from ${original})` : "";
    setStatus(
      `${bubbles} bubble${bubbles === 1 ? "" : "s"}${expansionTag} · ${name}`,
    );
    localStorage.setItem(STORAGE_KEY, name);
    syncUrl(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Error: ${message}`, true);
    root.replaceChildren();
  }
}

async function renderAll(root: HTMLElement): Promise<void> {
  const picker = $<HTMLSelectElement>("fixture-picker");
  const names: string[] = [];
  for (const opt of Array.from(picker.options)) {
    if (opt.value && opt.value !== ALL_VALUE) names.push(opt.value);
  }

  setStatus(`Loading ${names.length} fixtures…`);
  root.replaceChildren();

  const results = await Promise.allSettled(names.map(fetchFixture));

  let totalBubbles = 0;
  results.forEach((res, i) => {
    const name = names[i]!;
    if (res.status === "rejected") {
      const err = document.createElement("div");
      err.className = "fixture-section fixture-section--error";
      err.textContent = `${name} — failed to load (${res.reason})`;
      root.appendChild(err);
      return;
    }
    const conv = res.value;
    const labelOpt = Array.from(picker.options).find((o) => o.value === name);
    const label = labelOpt?.textContent?.trim() ?? name;
    const sectionHeader = buildSectionHeader(label, conv);
    root.appendChild(sectionHeader);

    const slot = document.createElement("div");
    slot.className = "fixture-section__chat";
    root.appendChild(slot);
    renderConversation(conv, slot);

    // Update the section sub-text now that we know the rendered bubble count.
    // For a 1-Graph-message Sentara forward this becomes "7 bubbles · expanded from 1 email · as Aviv".
    const sub = sectionHeader.querySelector(".fixture-section__sub");
    if (sub) sub.textContent = describeRenderedCounts(conv, slot);

    totalBubbles += slot.querySelectorAll(".row").length;
  });

  setStatus(`${results.length} fixtures · ${totalBubbles} bubbles total`);
  localStorage.setItem(STORAGE_KEY, ALL_VALUE);
  syncUrl(ALL_VALUE);
}

function syncUrl(name: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("fixture") === name) return;
  url.searchParams.set("fixture", name);
  window.history.replaceState({}, "", url.toString());
}

function pickInitialFixture(picker: HTMLSelectElement): string | null {
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
