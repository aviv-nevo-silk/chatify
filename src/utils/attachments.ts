// Attachment classification + chrome helpers.
//
// Three categories matter for rendering (see REQUIREMENTS §10):
//   1. inline-image  — referenced in the body via `<img src="cid:...">`
//   2. image-bubble  — pasted screenshot or other standalone image attachment
//   3. file-card     — anything else (PDFs, docs, archives, ...)

import type { AttachmentRef } from "../types.js";

export type AttachmentKind = "inline-image" | "image-bubble" | "file-card";

export function categorizeAttachment(att: AttachmentRef): AttachmentKind {
  if (att.isInline === true) return "inline-image";
  if (att.contentType?.toLowerCase().startsWith("image/")) return "image-bubble";
  return "file-card";
}

/**
 * Pick a chunky emoji icon for a file-card based on the MIME type. We try the
 * common families first and fall back to a generic page icon. The icon is
 * meant to be *recognizable at a glance*, not exhaustive.
 */
export function attachmentIcon(contentType: string): string {
  const ct = contentType.toLowerCase();

  if (ct === "application/pdf") return "📕";

  // Microsoft Word / OpenDocument text
  if (
    ct === "application/msword" ||
    ct ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ct === "application/vnd.oasis.opendocument.text"
  ) {
    return "📝";
  }

  // Excel / OpenDocument spreadsheet / CSV
  if (
    ct === "application/vnd.ms-excel" ||
    ct ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ct === "application/vnd.oasis.opendocument.spreadsheet" ||
    ct === "text/csv"
  ) {
    return "📊";
  }

  // Archives
  if (
    ct === "application/zip" ||
    ct === "application/x-zip-compressed" ||
    ct === "application/x-7z-compressed" ||
    ct === "application/x-rar-compressed" ||
    ct === "application/gzip" ||
    ct === "application/x-tar"
  ) {
    return "🗜";
  }

  return "📄";
}

/**
 * Format a byte count as the most natural human unit. Mirrors the convention
 * the WhatsApp/Outlook UIs use ("823 KB", "1.4 MB"). Uses base-1024 since
 * that's what file managers display.
 */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  // 1 decimal until GB, then 2 to keep precision visible.
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${fixed} ${units[unitIdx]}`;
}
