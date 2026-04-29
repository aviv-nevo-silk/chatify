// Deterministic sender-to-color mapping. The same email address always lands on
// the same palette slot so a person keeps their color across renders.
//
// The palette is curated for WhatsApp dark-theme bubble-headers: greens, blues,
// teals, oranges, pinks, purples — all readable on a dark background. We
// deliberately avoid red since red carries a "danger / unread" signal.
//
// The current user is NOT routed through `senderColor`; the renderer paints the
// out-bubble in WhatsApp's signature green directly.

export const SENDER_PALETTE = [
  "#25d366", // WhatsApp green (incoming variant, slightly desaturated)
  "#34b7f1", // sky blue
  "#00a884", // teal
  "#7c4dff", // deep purple
  "#ff8a65", // coral orange
  "#f4b400", // mustard yellow
  "#ec407a", // pink
  "#26c6da", // cyan
  "#9ccc65", // lime green
  "#ab47bc", // orchid
  "#5c6bc0", // indigo
  "#ffa726", // amber
  "#66bb6a", // grass green
  "#26a69a", // sea green
] as const;

export type SenderColor = (typeof SENDER_PALETTE)[number];

/**
 * Hash an email address (case-insensitive) into one of the palette colors.
 * Uses a small djb2-style accumulator — overkill is unnecessary, we just need
 * uniform distribution across ~14 slots.
 */
export function senderColor(email: string): string {
  const normalized = email.trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    // (hash << 5) + hash === hash * 33
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % SENDER_PALETTE.length;
  return SENDER_PALETTE[idx]!;
}
