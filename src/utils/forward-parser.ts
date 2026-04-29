// Forward-parser. Takes a Message whose body contains a forwarded reply chain
// (`From: / Sent: / To: / Subject:` headers separated by <hr/>) and expands
// it into virtual sub-messages so each forwarded reply becomes its own chat
// bubble.
//
// This handles the common case where an email thread was forwarded into your
// inbox as a single Graph message (because the inner messages went to a
// distribution list you weren't on, or come from outside your tenant).
//
// Limitations:
//   - English-only header keywords (From:/Sent:/To:/Subject:) for now.
//   - Splitter is `<hr/>`; some clients use other separators we don't catch.
//   - Decorative `<hr/>` between non-forwarded paragraphs will cause the
//     intermediate segment to be dropped if it doesn't match a header
//     pattern. Acceptable for v1.

import type { EmailAddress, Message } from "../types.js";

// Outlook serializes forwarded headers as a <p> or <div> that begins with
// `<b>From:</b>` followed soon after by `<b>Sent:</b>` and `<b>Subject:</b>`.
// The boundary BEFORE such a header may be `<hr/>` (most common) OR a styled
// `<div style="border:none;border-top:solid #E1E1E1 1.0pt;...">` block, OR
// nothing at all. Splitting on the header itself handles all three cases.
// `(?!\/)` excludes closing tags (`</p>`, `</div>`); we only want the
// opening-tag chain leading INTO `<b>From:</b>`. Without this, the regex
// could match starting at an EARLIER element (e.g. an empty `<p></p>`)
// and treat `</p>` as part of the chain — making segment boundaries land
// at the wrong place.
const HEADER_BOUNDARY_RE =
  /<(?:p|div)\b[^>]*>(?:\s*<(?!\/)[^>]+>)*\s*<b>\s*From:\s*<\/b>/gi;
const FROM_RE = /<b>\s*From:\s*<\/b>\s*([\s\S]+?)\s*<br/i;
const SENT_RE = /<b>\s*Sent:\s*<\/b>\s*([\s\S]+?)\s*<br/i;
const SUBJECT_RE = /<b>\s*Subject:\s*<\/b>\s*([\s\S]+?)(?:\s*<br|\s*<\/p>)/i;

/**
 * Expand a Message into virtual sub-messages by parsing the forwarded chain
 * inside its body. Returns [message] unchanged if no chain is detected.
 * Result is sorted ascending by sentDateTime.
 */
export function expandForwardedChain(message: Message): Message[] {
  const html = message.body.content;
  const segments = splitByForwardedHeaders(html);

  if (segments.length <= 1) return [message];

  const expanded: Message[] = [];

  // First segment = the new content from the original sender (no header).
  const newContent = segments[0]!;
  if (stripTags(newContent).trim().length > 0) {
    expanded.push({
      ...message,
      body: { contentType: "html", content: newContent },
    });
  }

  // Remaining segments each begin with a forwarded header.
  for (let i = 1; i < segments.length; i++) {
    const virt = parseForwardedSegment(segments[i]!, message, i);
    if (virt) expanded.push(virt);
  }

  if (expanded.length === 0) return [message];

  // Consolidate addresses: when the same person appears in multiple segments
  // with both a real and a synthesized (name-only) address, prefer the real
  // one everywhere so they get one consistent sender color.
  consolidateAddresses(expanded);

  expanded.sort(
    (a, b) =>
      new Date(a.sentDateTime).getTime() - new Date(b.sentDateTime).getTime(),
  );

  return expanded;
}

function consolidateAddresses(messages: Message[]): void {
  const nameToReal = new Map<string, string>();
  for (const m of messages) {
    if (!m.sender.address.endsWith("@unknown.local")) {
      nameToReal.set(m.sender.name.toLowerCase(), m.sender.address);
    }
  }
  for (const m of messages) {
    if (m.sender.address.endsWith("@unknown.local")) {
      const real = nameToReal.get(m.sender.name.toLowerCase());
      if (real) m.sender = { ...m.sender, address: real };
    }
  }
}

function splitByForwardedHeaders(html: string): string[] {
  // Find every position where a <p>/<div> opens and the first content inside
  // is a `<b>From:</b>` marker. Each such position is the START of a
  // forwarded segment. Everything before the first one is the new content.
  const positions: number[] = [];
  HEADER_BOUNDARY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_BOUNDARY_RE.exec(html)) !== null) {
    positions.push(m.index);
  }
  if (positions.length === 0) {
    const trimmed = html.trim();
    return trimmed ? [trimmed] : [];
  }
  const segments: string[] = [];
  // Segment 0: the original new content, before the first forwarded header.
  segments.push(stripTrailingSeparators(html.slice(0, positions[0])));
  // Each forwarded segment runs from its header start to the next header start (or EOF).
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!;
    const end = positions[i + 1] ?? html.length;
    segments.push(stripTrailingSeparators(html.slice(start, end)));
  }
  return segments.filter((s) => s.length > 0);
}

function stripTrailingSeparators(html: string): string {
  // Trailing <hr/> (or a div wrapping just an <hr/>) belongs to the boundary
  // between forwards, not the content of either side. Removing them ensures
  // the signature stripper can walk into the real last paragraph of a segment.
  let s = html.trim();
  for (;;) {
    const before = s.length;
    s = s.replace(/<hr\s*\/?>\s*$/i, "").trimEnd();
    s = s.replace(/<div\b[^>]*>\s*<hr\s*\/?>\s*<\/div>\s*$/i, "").trimEnd();
    if (s.length === before) break;
  }
  return s;
}

function parseForwardedSegment(
  segment: string,
  parent: Message,
  index: number,
): Message | null {
  // Parse the segment as a DOM tree so we can find the header element
  // properly and extract the body without leaving orphan close tags.
  // String-slicing on raw HTML loses or breaks the chunks where forwarded
  // headers are wrapped in nested <div>s (Outlook does this for the deepest
  // nesting levels and for "border-top:solid" styled separators).
  const doc = new DOMParser().parseFromString(
    `<div id="chatify-seg">${segment}</div>`,
    "text/html",
  );
  const root = doc.getElementById("chatify-seg");
  if (!root) return null;

  const headerEl = findHeaderElement(root);
  if (!headerEl) return null;

  const headerHtml = headerEl.innerHTML;
  const fromMatch = headerHtml.match(FROM_RE);
  const sentMatch = headerHtml.match(SENT_RE);
  if (!fromMatch || !sentMatch) return null;

  const sentDateTime = parseEmailDate(sentMatch[1] ?? "");
  if (!sentDateTime) return null;

  const subjectMatch = headerHtml.match(SUBJECT_RE);
  const sender = parseEmailAddress(fromMatch[1] ?? "");

  const bodyHtml = extractContentAfter(headerEl, root);

  return {
    id: `${parent.id}#virt-${index}`,
    conversationId: parent.conversationId,
    subject: subjectMatch
      ? decodeEntities(subjectMatch[1] ?? "").trim()
      : parent.subject,
    sender,
    toRecipients: [],
    ccRecipients: [],
    sentDateTime,
    receivedDateTime: sentDateTime,
    hasAttachments: false,
    body: { contentType: "html", content: bodyHtml },
  };
}

/**
 * Find the smallest <p>/<div> element under `root` that contains both
 * `<b>From:</b>` and `<b>Sent:</b>`. That's the header paragraph itself
 * (not a wrapper div around it).
 */
function findHeaderElement(root: HTMLElement): HTMLElement | null {
  const candidates = root.querySelectorAll("p, div");
  let result: HTMLElement | null = null;
  for (const el of Array.from(candidates)) {
    const html = el.innerHTML;
    if (!FROM_RE.test(html)) continue;
    if (!SENT_RE.test(html)) continue;
    // Smallest = the deepest element that still satisfies the test.
    if (!result || result.contains(el)) {
      result = el as HTMLElement;
    }
  }
  return result;
}

/**
 * Return the HTML of everything that appears AFTER `headerEl` in document
 * order, up to the root. This is the content that belongs to the forwarded
 * message (its body, attachments markup, etc.), excluding the header.
 *
 * Walks: headerEl's nextSiblings, then up to each ancestor and collects
 * THEIR nextSiblings, until reaching root.
 */
function extractContentAfter(headerEl: Element, root: Element): string {
  const parts: string[] = [];
  collectFollowingSiblings(headerEl, parts);
  let parent = headerEl.parentElement;
  while (parent && parent !== root) {
    collectFollowingSiblings(parent, parts);
    parent = parent.parentElement;
  }
  return parts.join("");
}

function collectFollowingSiblings(node: Element, parts: string[]): void {
  let sib: Element | null = node.nextElementSibling;
  while (sib) {
    parts.push(sib.outerHTML);
    sib = sib.nextElementSibling;
  }
}

function parseEmailAddress(text: string): EmailAddress {
  const decoded = decodeEntities(text.trim()).replace(/\s+/g, " ");
  const angleMatch = decoded.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1]!.trim(),
      address: angleMatch[2]!.trim().toLowerCase(),
    };
  }
  if (decoded.includes("@")) {
    return { name: decoded, address: decoded.toLowerCase() };
  }
  const slug = decoded
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "");
  return {
    name: decoded || "Unknown",
    address: `${slug || "unknown"}@unknown.local`,
  };
}

function parseEmailDate(text: string): string | null {
  const decoded = decodeEntities(text.trim());
  const d = new Date(decoded);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
