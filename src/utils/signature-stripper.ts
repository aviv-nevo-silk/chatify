// Strip email signatures and trailing closings from a message body before it
// gets rendered as a chat bubble. Chat doesn't have signatures — keeping them
// makes every message bloated and noisy.
//
// Strategy: walk the trailing block-level elements (last child first); remove
// each one that matches a signature heuristic; stop at the first non-match.
// Never strips from the middle of a body.
//
// Heuristics (any of these matches → strip):
//   1. Trailing empty paragraph
//   2. Closing salutation alone (Best, Thanks, Regards, Cheers, ...)
//   3. Mobile signature ("Get Outlook for iOS", "Sent from my iPhone", ...)
//   4. Multi-line paragraph containing a contact line (phone/URL/email)
//   5. Multi-line paragraph where every line is a salutation/name/title

const CLOSING_SALUTATIONS = [
  /^best\s*[,.\!]?\s*$/i,
  /^thanks?\s*[,.\!]?\s*$/i,
  /^regards\s*[,.]?\s*$/i,
  /^kind\s+regards\s*[,.]?\s*$/i,
  /^warm\s+regards\s*[,.]?\s*$/i,
  /^cheers\s*[,.\!]?\s*$/i,
  /^sincerely\s*[,.]?\s*$/i,
  /^thx\s*[,.]?\s*$/i,
  /^br\s*[,.]?\s*$/i,
  /^todah\s*[,.]?\s*$/i,
  /^תודה\s*[,.]?\s*$/i,
];

const MOBILE_SIG = [
  /^get\s+outlook\s+(for|on)\b/i,
  /^sent\s+from\s+my\s+(iphone|ipad|android|phone|mobile)/i,
  /^sent\s+from\s+outlook\s+for/i,
  /^השג\s+את\s+outlook/i,
];

const LONE_NAME = /^[A-Z][a-zA-Z'\-]+(\s+[A-Z][a-zA-Z'.\-]+){0,2}$/;
const CONTACT_LINE =
  /(\+?\d[\d\s\-().]{6,}\d)|(https?:\/\/)|([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/;
const TITLE_KEYWORDS =
  /\b(Manager|Director|Engineer|Lead|Architect|Sales|Marketing|Support|CEO|CTO|CFO|VP|HR|Specialist|Consultant|Officer|President|Founder|Designer|Developer|Analyst|Coordinator|Administrator|Technical|Executive|Senior|Principal|Staff|Associate|Head\s+of)\b/i;

const SIGNATURE_TAGS = new Set(["P", "DIV"]);

export function stripSignature(html: string): string {
  if (!html.trim()) return html;

  // Wrap so we always have a single root to walk children of.
  const doc = new DOMParser().parseFromString(
    `<div id="chatify-root">${html}</div>`,
    "text/html",
  );
  const root = doc.getElementById("chatify-root");
  if (!root) return html;

  // Walk children from the end. Stop at first non-signature element.
  while (root.lastElementChild) {
    const last = root.lastElementChild;
    if (!SIGNATURE_TAGS.has(last.tagName)) break;
    if (!isSignatureBlock(last)) break;
    last.remove();
  }

  // Also drop trailing whitespace text nodes left behind.
  while (
    root.lastChild &&
    root.lastChild.nodeType === Node.TEXT_NODE &&
    !(root.lastChild.textContent ?? "").trim()
  ) {
    root.removeChild(root.lastChild);
  }

  return root.innerHTML;
}

function isSignatureBlock(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  if (text === "") return true;

  // Long blocks (e.g. body paragraphs) are never signatures.
  if (text.length > 240) return false;

  const segments = splitByBr(el);
  if (segments.length === 0) return true;

  // Any line containing a contact (phone/URL/email) is a strong signature signal.
  if (segments.some((s) => CONTACT_LINE.test(s))) return true;

  // Otherwise: every segment must be a salutation, mobile sig, lone name, or title line.
  return segments.every(isSignatureLine);
}

function isSignatureLine(s: string): boolean {
  const text = s.trim();
  if (text === "") return true;
  if (CLOSING_SALUTATIONS.some((r) => r.test(text))) return true;
  if (MOBILE_SIG.some((r) => r.test(text))) return true;
  if (LONE_NAME.test(text)) return true;
  // Short title-only lines ("Senior Software Engineer", "Technical Support Manager, Americas.").
  if (text.length <= 60 && TITLE_KEYWORDS.test(text)) return true;
  return false;
}

function splitByBr(el: Element): string[] {
  // Split by <br>, then take textContent of each fragment.
  const fragments = el.innerHTML.split(/<br\s*\/?>/i);
  const tmp = document.createElement("div");
  return fragments
    .map((html) => {
      tmp.innerHTML = html;
      return (tmp.textContent ?? "").trim();
    })
    .filter((s) => s.length > 0);
}
