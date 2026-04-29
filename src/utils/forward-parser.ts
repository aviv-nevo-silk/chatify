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

const HR_SPLIT_RE = /<hr\s*\/?>/i;
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
  const segments = html
    .split(HR_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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

  expanded.sort(
    (a, b) =>
      new Date(a.sentDateTime).getTime() - new Date(b.sentDateTime).getTime(),
  );

  return expanded;
}

function parseForwardedSegment(
  segment: string,
  parent: Message,
  index: number,
): Message | null {
  const fromMatch = segment.match(FROM_RE);
  const sentMatch = segment.match(SENT_RE);
  if (!fromMatch || !sentMatch) return null;

  const sentDateTime = parseEmailDate(sentMatch[1] ?? "");
  if (!sentDateTime) return null;

  const subjectMatch = segment.match(SUBJECT_RE);
  const sender = parseEmailAddress(fromMatch[1] ?? "");

  // Body = everything after the closing </p> of the header paragraph.
  const headerEnd = segment.indexOf("</p>");
  const bodyHtml = headerEnd >= 0 ? segment.slice(headerEnd + 4).trim() : "";

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
