// DOMPurify wrapper with a Chatify-specific allowlist. Email HTML is hostile —
// invisible tracking pixels, JS-via-attribute, srcdoc iframes — so we keep the
// tag/attr lists minimal, force every link to open safely, and drop remote
// `<img>` tags (only `cid:` and `data:` URLs are kept since those are inline
// attachments we control).

import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "a",
  "ul",
  "ol",
  "li",
  "span",
  "div",
  "img",
  "blockquote",
  "code",
  "pre",
  "hr",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "dir",
  "lang",
  "data-mention-email",
];

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;

  // Force every anchor to open in a new tab without leaking the opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  // Drop only OBVIOUSLY hostile <img> srcs. Inline (`cid:`, `data:`) and
  // ordinary https URLs are fine — the user already opened this email in
  // Outlook, which loaded the same images, so showing them in Chatify
  // adds no fresh tracking exposure but lets us render screenshots,
  // diagrams, and signature logos. Block http (mixed content) and
  // javascript: URIs.
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "img") return;
    if (!(node instanceof Element)) return;
    const src = (node.getAttribute("src") ?? "").trim();
    const ok =
      src.startsWith("data:") ||
      src.startsWith("cid:") ||
      src.startsWith("https://") ||
      src.startsWith("//");
    if (!ok) {
      node.parentNode?.removeChild(node);
    }
  });

  hooksInstalled = true;
}

export function sanitizeBodyHtml(html: string): string {
  installHooks();
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Don't return a DOM node — we want a string to feed into innerHTML.
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
  // DOMPurify's TS overloads can return TrustedHTML; coerce to string.
  return typeof clean === "string" ? clean : String(clean);
}
