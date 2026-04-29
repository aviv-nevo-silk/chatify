// Mention decoration. Email bodies coming from Graph + Outlook already include
// `<a class="mention" data-mention-email="...">` markup for explicit @mentions
// inserted via Outlook's mention UI (see fixtures/gil-niv-mixed-hebrew.json
// rows 3 and 4). Our job here is purely cosmetic: we attach a CSS variable
// pointing at the *sender's* color so the pill matches the rest of the bubble.
//
// We deliberately do NOT try to find plaintext "@FirstName" patterns. v1's
// REQUIREMENTS.md §10.4 calls that out as too noisy.

/**
 * Walk all `a.mention` anchors in the given HTML string and ensure each one
 * carries a `style="--mention-color: <senderColor>"` attribute (only if not
 * already present). The href is left untouched. Anchors that already have a
 * `style` attribute keep theirs and we append our variable.
 */
export function decorateMentions(
  htmlContent: string,
  senderColor: string,
): string {
  // Parse into a detached document so we get real DOM semantics. The input has
  // already been DOMPurify-sanitized by the caller, so this is safe.
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${htmlContent}</body>`,
    "text/html",
  );
  const anchors = doc.body.querySelectorAll<HTMLAnchorElement>("a.mention");
  if (anchors.length === 0) return htmlContent;

  for (const a of Array.from(anchors)) {
    const existing = a.getAttribute("style") ?? "";
    if (existing.includes("--mention-color")) continue;
    const sep = existing.length > 0 && !existing.trim().endsWith(";") ? "; " : "";
    a.setAttribute("style", `${existing}${sep}--mention-color: ${senderColor}`);
  }
  return doc.body.innerHTML;
}
