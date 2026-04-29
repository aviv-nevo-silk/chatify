// Per-bubble RTL detection. Email threads in our test set frequently mix
// English and Hebrew replies in the same conversation, so a document-level
// `dir` attribute is wrong — each bubble decides for itself.
//
// Strategy: Unicode "first strong character" heuristic (UAX #9). We scan the
// text for the first character with a strong directional property; if it's
// in the Hebrew or Arabic ranges we render RTL, otherwise LTR.

/** Hebrew block (incl. presentation forms) and the Arabic blocks. */
function isStrongRtl(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x05ff) || // Hebrew
    (codePoint >= 0xfb1d && codePoint <= 0xfb4f) || // Hebrew presentation forms
    (codePoint >= 0x0600 && codePoint <= 0x06ff) || // Arabic
    (codePoint >= 0x0750 && codePoint <= 0x077f) || // Arabic supplement
    (codePoint >= 0x08a0 && codePoint <= 0x08ff) || // Arabic extended-A
    (codePoint >= 0xfb50 && codePoint <= 0xfdff) || // Arabic presentation forms-A
    (codePoint >= 0xfe70 && codePoint <= 0xfeff) // Arabic presentation forms-B
  );
}

/** Strong-LTR ranges we care about. The default LTR fallback handles the rest. */
function isStrongLtr(codePoint: number): boolean {
  return (
    (codePoint >= 0x0041 && codePoint <= 0x005a) || // A-Z
    (codePoint >= 0x0061 && codePoint <= 0x007a) || // a-z
    (codePoint >= 0x00c0 && codePoint <= 0x024f) // Latin-1 Supplement + Extended-A/B
  );
}

export function detectDir(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (isStrongRtl(cp)) return "rtl";
    if (isStrongLtr(cp)) return "ltr";
  }
  return "ltr";
}

/**
 * Strip HTML tags from `htmlContent` and run `detectDir` over the remaining
 * text. We only need a coarse strip — entities, attributes, and tag bodies are
 * all dropped; the first strong character in the visible text wins.
 */
export function bubbleDir(htmlContent: string): "ltr" | "rtl" {
  // Remove tags. We don't need a real HTML parser here — the goal is "skip
  // markup, look at the text" — and email HTML doesn't contain raw `<` in
  // text after sanitization.
  const stripped = htmlContent
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ");
  return detectDir(stripped);
}
