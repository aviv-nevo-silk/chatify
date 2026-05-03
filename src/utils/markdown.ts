// Tiny safe markdown renderer for LLM-generated text. Handles only the
// constructs llama-class models reliably emit: **bold**, *italic*,
// `inline code`, ATX headings (#..######), unordered (* / -) and ordered
// (1.) lists, and paragraph breaks (blank-line separated).
//
// Input is HTML-escaped first so literal HTML in the LLM output renders
// as visible text — never interpreted. Only the markdown patterns we
// explicitly translate become real tags.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let r = text;
  // Bold ** ** matched first so the leftover * doesn't trigger italic.
  r = r.replace(/\*\*([^\n*][^\n]*?)\*\*/g, "<strong>$1</strong>");
  // Italic * * — guarded so it doesn't match adjacent ** or word-internal *.
  r = r.replace(/(?<![*\w])\*([^\n*]+?)\*(?![*\w])/g, "<em>$1</em>");
  // Inline `code`.
  r = r.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  return r;
}

export function renderMarkdown(text: string): string {
  const lines = escapeHtml(text).split("\n");
  const out: string[] = [];

  let inUl = false;
  let inOl = false;
  let inP = false;

  const closeUl = (): void => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };
  const closeOl = (): void => {
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const closeP = (): void => {
    if (inP) {
      out.push("</p>");
      inP = false;
    }
  };
  const closeAll = (): void => {
    closeUl();
    closeOl();
    closeP();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (!line) {
      // Blank line → close everything. The next non-blank line starts a
      // fresh block (new paragraph, new list, etc.).
      closeAll();
      continue;
    }

    const bullet = line.match(/^\s*[*-]\s+(.+)$/);
    if (bullet) {
      closeP();
      closeOl();
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(bullet[1]!)}</li>`);
      continue;
    }

    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numbered) {
      closeP();
      closeUl();
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inlineFormat(numbered[1]!)}</li>`);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      closeAll();
      out.push(
        `<p class="md-heading"><strong>${inlineFormat(heading[1]!)}</strong></p>`,
      );
      continue;
    }

    // Plain text line. If we're inside a list, treat it as a continuation
    // of the last <li> (wrapped line under a bullet). Strip leading
    // whitespace so the indent doesn't render.
    if (inUl || inOl) {
      const last = out.pop() ?? "";
      const trimmed = line.replace(/^\s+/, "");
      out.push(
        last.replace(/<\/li>$/, `<br>${inlineFormat(trimmed)}</li>`),
      );
      continue;
    }

    if (!inP) {
      out.push("<p>");
      inP = true;
      out.push(inlineFormat(line));
    } else {
      out.push(`<br>${inlineFormat(line)}`);
    }
  }
  closeAll();
  return out.join("");
}
