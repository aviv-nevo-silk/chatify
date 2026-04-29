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
  EmailAddress,
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
  // Walk through messages chronologically and track who has been a participant
  // so far. Whenever a message brings in a new recipient, emit an inline
  // "X added Y to the conversation" event right before the bubble — same
  // metaphor as "added to group" in WhatsApp/Slack.
  const knownParticipants = new Set<string>();

  for (const message of sorted) {
    const sentAt = new Date(message.sentDateTime);

    if (prevDate === null || !sameDay(prevDate, sentAt)) {
      container.appendChild(buildDayDivider(sentAt, today));
    }
    prevDate = sentAt;

    if (knownParticipants.size > 0) {
      const newPeople = newRecipients(message, knownParticipants);
      if (newPeople.length > 0) {
        container.appendChild(
          buildAddedEvent(message.sender.name, newPeople, currentUserAddr),
        );
      }
    }
    addParticipants(message, knownParticipants);

    container.appendChild(buildRow(message, currentUserAddr, sentAt));
  }
}

// ----- system events ------------------------------------------------------
//
// Inline "added to the conversation" events. A message brings new people in
// when its to/cc list contains addresses that haven't appeared in any prior
// message's sender or recipients. The event is rendered as a chip right
// before that message's bubble.

function newRecipients(
  message: Message,
  known: Set<string>,
): EmailAddress[] {
  const senderAddr = message.sender.address.toLowerCase();
  const out: EmailAddress[] = [];
  // Pre-seed `seen` with the sender so a message that includes its own
  // sender in to/cc doesn't produce an "X added X" self-event.
  const seen = new Set<string>([senderAddr]);
  for (const r of [...message.toRecipients, ...message.ccRecipients]) {
    const addr = r.address.toLowerCase();
    if (known.has(addr)) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(r);
  }
  return out;
}

function addParticipants(message: Message, known: Set<string>): void {
  known.add(message.sender.address.toLowerCase());
  for (const r of [...message.toRecipients, ...message.ccRecipients]) {
    known.add(r.address.toLowerCase());
  }
}

function buildAddedEvent(
  actorName: string,
  newPeople: EmailAddress[],
  currentUserAddr: string,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "system-event";
  const label = document.createElement("span");
  label.className = "system-event__label";
  label.textContent = `↗ ${actorName} added ${formatAddedNames(newPeople, currentUserAddr)} to the conversation`;
  wrapper.appendChild(label);
  return wrapper;
}

function formatAddedNames(
  people: EmailAddress[],
  currentUserAddr: string,
): string {
  // "you" if current user is in the set; mention by name otherwise.
  // Multiple people: "you, Marc, Sandra" or "Marc and Sandra".
  const tokens = people.map((p) =>
    p.address.toLowerCase() === currentUserAddr ? "you" : p.name,
  );
  if (tokens.length === 1) return tokens[0]!;
  if (tokens.length === 2) return `${tokens[0]} and ${tokens[1]}`;
  return `${tokens.slice(0, -1).join(", ")}, and ${tokens[tokens.length - 1]}`;
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
