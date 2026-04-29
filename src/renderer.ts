// Chat-bubble renderer. Consumes a Microsoft Graph-shaped Conversation and
// produces DOM under the given container. v1 keeps the structure flat: one
// `.row` per message, no consecutive-message merging, no signature stripping.
//
// Class-name contract (kept in sync with the parallel CSS work):
//   .day-divider                        — date separator, child <span> holds label
//   .row                                — wrapper for a single message
//   .row.row--in / .row.row--out        — incoming (left) / outgoing (right)
//   .row.row--rtl                       — bubble's natural direction is RTL
//   .bubble                             — the colored bubble itself
//   .bubble__sender                     — sender name line (incoming only)
//   .bubble__content                    — sanitized email body HTML
//   .bubble__attachments                — container for image-bubble + file-card
//   .bubble__meta                       — time stamp footer
//   .inline-image                       — wraps each `<img cid:...>` inside body
//   .image-bubble                       — standalone image attachment
//   .attachment-card                    — file-card chip for non-image files
//   .attachment-card__icon / __name / __size — chip subcomponents
//
// Inline CSS variables emitted on rows / mentions:
//   --sender-color    on .row.row--in   (used by .bubble__sender, mention pill)
//   --mention-color   on a.mention      (set by decorateMentions)

import type {
  AttachmentRef,
  Conversation,
  Message,
} from "./types.js";
import { senderColor } from "./utils/color.js";
import { bubbleDir } from "./utils/rtl.js";
import { sanitizeBodyHtml } from "./utils/sanitize.js";
import { decorateMentions } from "./utils/mentions.js";
import { stripSignature } from "./utils/signature-stripper.js";
import {
  categorizeAttachment,
  attachmentIcon,
  humanSize,
} from "./utils/attachments.js";
import { formatDayDivider, formatBubbleTime, sameDay } from "./utils/dates.js";
import { expandForwardedChain } from "./utils/forward-parser.js";

const MAX_FILENAME_DISPLAY = 40;

export function renderConversation(
  conversation: Conversation,
  container: HTMLElement,
): void {
  container.replaceChildren();

  // Detect "forwarded to you" events at conversation level, before any
  // expansion happens. These render as system-event lines at the top of the
  // chat (analogous to "X added you to the group" in WhatsApp/Slack).
  for (const ev of computeSystemEvents(conversation)) {
    container.appendChild(buildSystemEvent(ev));
  }

  // Expand each Graph message into virtual sub-messages by parsing forwarded
  // chains in its body. A single Graph message containing a deeply-nested
  // forward becomes N bubbles instead of one giant text dump.
  const expanded = conversation.messages.flatMap(expandForwardedChain);
  const sorted = expanded.sort(
    (a, b) =>
      new Date(a.sentDateTime).getTime() - new Date(b.sentDateTime).getTime(),
  );

  const today = new Date();
  let prevDate: Date | null = null;
  const currentUserAddr = conversation.currentUser.address.toLowerCase();

  for (const message of sorted) {
    const sentAt = new Date(message.sentDateTime);

    if (prevDate === null || !sameDay(prevDate, sentAt)) {
      container.appendChild(buildDayDivider(sentAt, today));
    }
    prevDate = sentAt;

    container.appendChild(buildRow(message, currentUserAddr, sentAt));
  }
}

// ----- system events ------------------------------------------------------

interface SystemEvent {
  kind: "forwarded";
  actorName: string;
  date: Date;
}

function computeSystemEvents(conversation: Conversation): SystemEvent[] {
  const events: SystemEvent[] = [];
  const target = conversation.currentUser.address.toLowerCase();
  for (const m of conversation.messages) {
    const expanded = expandForwardedChain(m);
    if (expanded.length <= 1) continue;
    const recipientMatch = [...m.toRecipients, ...m.ccRecipients].some(
      (r) => r.address.toLowerCase() === target,
    );
    if (!recipientMatch) continue;
    if (m.sender.address.toLowerCase() === target) continue;
    events.push({
      kind: "forwarded",
      actorName: m.sender.name,
      date: new Date(m.sentDateTime),
    });
  }
  return events;
}

function buildSystemEvent(ev: SystemEvent): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "system-event";
  const label = document.createElement("span");
  label.className = "system-event__label";
  label.textContent = `↗ ${ev.actorName} forwarded this thread to you`;
  wrapper.appendChild(label);
  return wrapper;
}

// ----- builders -----------------------------------------------------------

function buildDayDivider(d: Date, today: Date): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "day-divider";
  const label = document.createElement("span");
  label.textContent = formatDayDivider(d, today);
  wrapper.appendChild(label);
  return wrapper;
}

function buildRow(
  message: Message,
  currentUserAddr: string,
  sentAt: Date,
): HTMLElement {
  const isOut = message.sender.address.toLowerCase() === currentUserAddr;
  const senderHex = senderColor(message.sender.address);

  const row = document.createElement("div");
  row.className = isOut ? "row row--out" : "row row--in";
  if (!isOut) row.style.setProperty("--sender-color", senderHex);

  if (bubbleDir(message.body.content) === "rtl") {
    row.classList.add("row--rtl");
  }

  row.appendChild(buildBubble(message, isOut, senderHex, sentAt));
  return row;
}

function buildBubble(
  message: Message,
  isOut: boolean,
  senderHex: string,
  sentAt: Date,
): HTMLElement {
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (!isOut) {
    const sender = document.createElement("div");
    sender.className = "bubble__sender";
    sender.textContent = message.sender.name;
    bubble.appendChild(sender);
  }

  bubble.appendChild(buildContent(message, senderHex));

  const inlineImageAtts: AttachmentRef[] = [];
  const imageBubbleAtts: AttachmentRef[] = [];
  const fileCardAtts: AttachmentRef[] = [];
  for (const att of message.attachments ?? []) {
    const kind = categorizeAttachment(att);
    if (kind === "inline-image") inlineImageAtts.push(att);
    else if (kind === "image-bubble") imageBubbleAtts.push(att);
    else fileCardAtts.push(att);
  }

  // Resolve cid: refs inside the already-rendered .bubble__content.
  if (inlineImageAtts.length > 0) {
    const contentEl = bubble.querySelector<HTMLElement>(".bubble__content");
    if (contentEl) resolveInlineImages(contentEl, inlineImageAtts);
  }

  if (imageBubbleAtts.length > 0 || fileCardAtts.length > 0) {
    const attRow = document.createElement("div");
    attRow.className = "bubble__attachments";
    for (const att of imageBubbleAtts) attRow.appendChild(buildImageBubble(att));
    for (const att of fileCardAtts) attRow.appendChild(buildFileCard(att));
    bubble.appendChild(attRow);
  }

  const meta = document.createElement("div");
  meta.className = "bubble__meta";
  meta.textContent = formatBubbleTime(sentAt);
  bubble.appendChild(meta);

  return bubble;
}

function buildContent(message: Message, senderHex: string): HTMLElement {
  const content = document.createElement("div");
  content.className = "bubble__content";

  // Strip trailing signatures and closings BEFORE sanitization so DOMPurify
  // sees the trimmed body. Sanitizer guards untrusted HTML; signature stripper
  // is just noise reduction.
  const stripped = stripSignature(message.body.content);
  const cleaned = sanitizeBodyHtml(stripped);
  const decorated = decorateMentions(cleaned, senderHex);
  // `decorated` came out of DOMPurify and our DOMParser round-trip — safe.
  content.innerHTML = decorated;

  return content;
}

// ----- attachment helpers -------------------------------------------------

function buildImageBubble(att: AttachmentRef): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "image-bubble";

  const img = document.createElement("img");
  img.alt = att.name;
  if (att.contentBytes) {
    img.src = `data:${att.contentType};base64,${att.contentBytes}`;
  } else {
    // TODO: fetch via Microsoft Graph `/attachments/{id}/$value` when
    // contentBytes is absent (real Outlook integration, not fixtures).
    img.src = "";
    img.dataset.attachmentId = att.id;
  }
  wrapper.appendChild(img);

  return wrapper;
}

function buildFileCard(att: AttachmentRef): HTMLElement {
  const card = document.createElement("div");
  card.className = "attachment-card";
  // TODO: clicking should download via Graph `/attachments/{id}/$value`.
  card.dataset.attachmentId = att.id;

  const icon = document.createElement("span");
  icon.className = "attachment-card__icon";
  icon.textContent = attachmentIcon(att.contentType);
  card.appendChild(icon);

  const name = document.createElement("span");
  name.className = "attachment-card__name";
  name.title = att.name;
  name.textContent = truncateFilename(att.name, MAX_FILENAME_DISPLAY);
  card.appendChild(name);

  const size = document.createElement("span");
  size.className = "attachment-card__size";
  size.textContent = humanSize(att.size);
  card.appendChild(size);

  return card;
}

/**
 * Walk the bubble content for `<img src="cid:...">` tags and swap their src
 * for the matching attachment's contentBytes (rendered as a data URL). Wraps
 * each match in a `<div class="inline-image">` so the CSS can size/round it
 * without affecting other elements.
 *
 * TODO: when `contentBytes` is missing (real Graph response), fetch from
 * `/me/messages/{id}/attachments/{attId}/$value` and stash the resulting
 * blob URL on the img instead.
 */
function resolveInlineImages(
  contentEl: HTMLElement,
  inlineAtts: AttachmentRef[],
): void {
  const byCid = new Map<string, AttachmentRef>();
  for (const att of inlineAtts) {
    if (att.contentId) byCid.set(att.contentId.toLowerCase(), att);
  }

  const imgs = contentEl.querySelectorAll<HTMLImageElement>('img[src^="cid:"]');
  for (const img of Array.from(imgs)) {
    const src = img.getAttribute("src") ?? "";
    const cid = src.slice("cid:".length).toLowerCase();
    const att = byCid.get(cid);
    if (att && att.contentBytes) {
      img.setAttribute(
        "src",
        `data:${att.contentType};base64,${att.contentBytes}`,
      );
    } else if (att) {
      // We have the attachment metadata but no bytes yet.
      img.removeAttribute("src");
      img.dataset.attachmentId = att.id;
    }

    // Wrap the image in a .inline-image div so CSS targets it precisely.
    const parent = img.parentNode;
    if (parent && !(parent instanceof HTMLElement && parent.classList.contains("inline-image"))) {
      const wrap = document.createElement("div");
      wrap.className = "inline-image";
      parent.insertBefore(wrap, img);
      wrap.appendChild(img);
    }
  }
}

function truncateFilename(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  // Preserve extension when possible.
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot >= name.length - 8) {
    const ext = name.slice(dot);
    const head = name.slice(0, Math.max(1, maxLen - ext.length - 1));
    return `${head}…${ext}`;
  }
  return `${name.slice(0, maxLen - 1)}…`;
}
