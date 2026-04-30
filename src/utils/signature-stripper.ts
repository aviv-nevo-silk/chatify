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
  /^best(\s+(regards|wishes))?\s*[,.\!]?\s*$/i,
  /^thank\s+you(\s+very\s+much)?\s*[,.\!]?\s*$/i,
  /^thanks?(\s+(again|so\s+much|a\s+lot))?\s*[,.\!]?\s*$/i,
  /^thanks?\s+in\s+advance\s*[,.\!]?\s*$/i,
  /^regards\s*[,.]?\s*$/i,
  /^kind\s+regards\s*[,.]?\s*$/i,
  /^warm\s+regards\s*[,.]?\s*$/i,
  /^cheers\s*[,.\!]?\s*$/i,
  /^sincerely(\s+yours)?\s*[,.]?\s*$/i,
  /^yours(\s+truly)?\s*[,.]?\s*$/i,
  /^thx\s*[,.]?\s*$/i,
  /^br\s*[,.]?\s*$/i,
  /^todah\s*[,.]?\s*$/i,
  /^תודה\s*[,.]?\s*$/i,
  /^talk\s+(soon|to\s+you\s+soon)\s*[,.\!]?\s*$/i,
  /^take\s+care\s*[,.\!]?\s*$/i,
  /^all\s+the\s+best\s*[,.]?\s*$/i,
  /^much\s+appreciated\s*[,.\!]?\s*$/i,
  /^appreciated\s*[,.\!]?\s*$/i,
  /^looking\s+forward\s+to\s+(your\s+)?(reply|response)\s*[,.\!]?\s*$/i,
];

// Confidentiality / disclaimer footer text that legal departments append.
const DISCLAIMER = [
  /confidentiality\s+notice/i,
  /this\s+(e-?mail|message|communication)\s+(and\s+any\s+attachments?\s+)?(is|are|may\s+be)\s+confidential/i,
  /privileged\s+and\s+confidential/i,
  /unauthorized\s+(use|disclosure|distribution|copying|review|dissemination)/i,
  /^if\s+you\s+(have\s+)?received\s+this\s+(e-?mail|message)/i,
  /please\s+(notify\s+the\s+sender|destroy\s+the\s+original)/i,
];

const MOBILE_SIG = [
  /^get\s+outlook\s+(for|on)\b/i,
  /^sent\s+from\s+my\s+(iphone|ipad|android|phone|mobile)/i,
  /^sent\s+from\s+outlook\s+for/i,
  /^השג\s+את\s+outlook/i,
];

// Calendar/meeting invite boilerplate. When an email comes from a Teams /
// Zoom / Meet / WebEx invite, Outlook auto-generates this block. It's
// noise in a chat view — same as a signature.
const MEETING_BOILERPLATE = [
  /microsoft\s+teams\s+meeting/i,
  /join\s+microsoft\s+teams/i,
  /^join\s*:/i,
  /^meeting\s+id\s*:/i,
  /^passcode\s*:/i,
  /teams\.microsoft\.com\/(meet|l\/meetup-join)/i,
  /zoom\.us\/j\//i,
  /^need\s+help\?/i,
  /^system\s+reference\s*$/i,
  /^for\s+organizers\s*:/i,
  /^meeting\s+options\s*$/i,
  /meet\.google\.com\//i,
  /^webex\s+meeting/i,
];

// Visual separator lines (rows of underscores, dashes, or equals).
const SEPARATOR_LINE = /^[_\-=*\s]{3,}$/;

const LONE_NAME = /^[A-Z][a-zA-Z'\-]+(\s+[A-Z][a-zA-Z'.\-]+){0,2}$/;
// Phone patterns require either a `+` country-code prefix OR a separator
// (space/dash/paren) inside the digit run. This excludes false positives
// like `/public/.../00072236/` (a path) and `Build #148462` (a ticket).
const PHONE_INTL = /\+\d{1,4}[\s\-]?\d[\d\s\-().]{5,}\d/;
const PHONE_SEP = /\d{1,4}[\s\-()]\d[\d\s\-().]{5,}\d/;
// Match http(s):// AND scheme-less www. URLs (signatures often render as
// "www.silk.us" with the scheme only on the underlying href).
const URL_RE = /(?:https?:\/\/|www\.)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/i;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const CONTACT_LINE_RE = new RegExp(
  `(${PHONE_INTL.source})|(${PHONE_SEP.source})|(${URL_RE.source})|(${EMAIL_RE.source})`,
);
const TITLE_KEYWORDS =
  /\b(Manager|Director|Engineer|Lead|Architect|Sales|Marketing|Support|CEO|CTO|CFO|VP|HR|Specialist|Consultant|Officer|President|Founder|Designer|Developer|Analyst|Coordinator|Administrator|Technical|Executive|Senior|Principal|Staff|Associate|Head\s+of)\b/i;

// Signature blocks come wrapped in different tags depending on the mail client:
//   <p>/<div>  most common (Outlook, Gmail web)
//   <table>    when the signature uses a 2-column layout (logo + contact)
//              Outlook's "create signature" UI generates these by default.
//   <img>      Outlook "Roaming Signatures" embeds the signature as an
//              image (often with alt="signature_<digits>"); social-media
//              icons at the very end of a signature are also <img>.
//   <br>       trailing blank lines between elements.
const SIGNATURE_TAGS = new Set(["P", "DIV", "TABLE", "IMG", "BR"]);

// Outlook's "Description automatically generated" alt-text and Roaming
// Signature image filenames give us a strong signal that an <img> at the
// end of a body is signature decoration, not actual content.
const SIGNATURE_IMG_ALT = [
  /^signature[_\-]\d/i,
  /description\s+automatically\s+generated/i,
];

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
  // Trailing <br> tags are always disposable.
  if (el.tagName === "BR") return true;

  // Trailing <img> tags: keep if the alt text suggests real content
  // (e.g. "Q3 chart"), strip if it's signature decoration or social-media
  // icon alt text auto-generated by Word/Outlook.
  if (el.tagName === "IMG") {
    const alt = (el.getAttribute("alt") ?? "").trim();
    if (alt === "") return true;
    return SIGNATURE_IMG_ALT.some((r) => r.test(alt));
  }

  const text = (el.textContent ?? "").trim();
  if (text === "") return true;

  // Long blocks (e.g. body paragraphs) are never signatures.
  if (text.length > 240) return false;

  // Count inner paragraphs that look like real body content — substantive
  // length (> 50 chars) AND don't match signature patterns. Three or more
  // such paragraphs = body block, not signature. Real signatures have
  // short lines (name/title/email/phone) so they don't trip this check.
  let bodyLikeCount = 0;
  const seen = new Set<string>();
  for (const child of Array.from(el.querySelectorAll("p, div"))) {
    const t = (child.textContent ?? "").trim();
    if (t.length < 50) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    const childSegs = splitByBr(child);
    if (childSegs.length > 0 && childSegs.every(isSignatureLine)) continue;
    if (childSegs.length > 0 && childSegs.some((s) => CONTACT_LINE_RE.test(s)))
      continue;
    bodyLikeCount++;
    if (bodyLikeCount >= 3) return false;
  }

  const segments = splitByBr(el);
  if (segments.length === 0) return true;

  // Any line containing a contact (phone/URL/email) is a strong signature signal.
  if (segments.some((s) => CONTACT_LINE_RE.test(s))) return true;

  // Calendar invite boilerplate (Teams, Zoom, etc.) is also stripable.
  if (segments.some((s) => MEETING_BOILERPLATE.some((r) => r.test(s)))) {
    return true;
  }

  // Legal disclaimer / confidentiality footer.
  if (segments.some((s) => DISCLAIMER.some((r) => r.test(s)))) return true;

  // Otherwise: every segment must be a salutation, mobile sig, lone name, or title line.
  return segments.every(isSignatureLine);
}

function isSignatureLine(s: string): boolean {
  const text = s.trim();
  if (text === "") return true;
  if (SEPARATOR_LINE.test(text)) return true;
  if (CLOSING_SALUTATIONS.some((r) => r.test(text))) return true;
  if (MOBILE_SIG.some((r) => r.test(text))) return true;
  if (MEETING_BOILERPLATE.some((r) => r.test(text))) return true;
  if (DISCLAIMER.some((r) => r.test(text))) return true;
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
