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
// Phone patterns require either a `+` country-code prefix OR a separator
// (space/dash/paren) inside the digit run. This excludes false positives
// like `/public/.../00072236/` (a path) and `Build #148462` (a ticket).
const PHONE_INTL = /\+\d{1,4}[\s\-]?\d[\d\s\-().]{5,}\d/;
const PHONE_SEP = /\d{1,4}[\s\-()]\d[\d\s\-().]{5,}\d/;
const URL_RE = /https?:\/\//;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const CONTACT_LINE_RE = new RegExp(
  `(${PHONE_INTL.source})|(${PHONE_SEP.source})|(${URL_RE.source})|(${EMAIL_RE.source})`,
);
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
  // After each removal, undo if we would empty the body — a one-liner like
  // "Thanks" or "Best," IS the entire message, not a signature.
  while (root.lastElementChild) {
    const last = root.lastElementChild;
    if (!SIGNATURE_TAGS.has(last.tagName)) break;
    if (!isSignatureBlock(last)) break;
    const nextSibling = last.nextSibling; // for re-insertion if we undo
    last.remove();
    if (!hasMeaningfulContent(root)) {
      // Restore at original position and stop.
      if (nextSibling) {
        root.insertBefore(last, nextSibling);
      } else {
        root.appendChild(last);
      }
      break;
    }
  }

  // Also drop trailing whitespace text nodes left behind, but only if
  // there's still real content remaining.
  while (
    root.lastChild &&
    root.lastChild.nodeType === Node.TEXT_NODE &&
    !(root.lastChild.textContent ?? "").trim()
  ) {
    if (root.children.length === 0) break;
    root.removeChild(root.lastChild);
  }

  return root.innerHTML;
}

function hasMeaningfulContent(root: Element): boolean {
  return root.children.length > 0 || (root.textContent ?? "").trim().length > 0;
}

function isSignatureBlock(el: Element): boolean {
  const text = (el.textContent ?? "").trim();
  if (text === "") return true;

  // Long blocks (e.g. body paragraphs) are never signatures.
  if (text.length > 240) return false;

  // A wrapper element containing 3+ meaningful inner paragraphs is a body
  // block, not a signature. Real signatures are small (one paragraph or a
  // few short <br>-separated lines). This also catches the case where a
  // body paragraph happens to mention a phone-like digit run (a path, a
  // ticket number, a build #).
  let innerMeaningful = 0;
  for (const child of Array.from(el.querySelectorAll("p, div"))) {
    const t = (child.textContent ?? "").trim();
    if (t.length > 5) innerMeaningful++;
    if (innerMeaningful >= 3) return false;
  }

  const segments = splitByBr(el);
  if (segments.length === 0) return true;

  // Any line containing a contact (phone/URL/email) is a strong signature signal.
  if (segments.some((s) => CONTACT_LINE_RE.test(s))) return true;

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
