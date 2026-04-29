// Date formatting helpers for chat-style rendering.

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Day-divider label. Returns "Today" or "Yesterday" when applicable, otherwise
 * a long form like "Wednesday, March 18, 2026". Locale-aware; the long form
 * follows the user's browser locale for the weekday/month names.
 */
export function formatDayDivider(d: Date, today: Date): string {
  if (sameDay(d, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Bubble timestamp — 24h "13:34" form. We pin to en-GB (24h hh:mm) rather
 * than the user's locale because mixed-locale threads otherwise drift between
 * 12h and 24h presentation, which is jarring.
 */
export function formatBubbleTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
