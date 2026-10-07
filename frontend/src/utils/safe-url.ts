/**
 * EventHub — Safe external URLs (Part 7, §27)
 * ───────────────────────────────────────────
 * `org.website`, `speaker.linkedin` and `event.onlineEventLink` are
 * user-supplied and rendered as `href`. A stored value of
 * `javascript:alert(document.cookie)` is a stored XSS: React warns about this
 * in development but still renders the URL.
 *
 * The backend rejects non-http(s) at write time, so this is defence in depth —
 * but it is not redundant. Data written before the backend guard existed is
 * still in the database, and a future code path could bypass validation.
 * The sink, not just the source, has to be safe.
 *
 * Returns null when the URL is absent or unsafe; callers render nothing,
 * because a broken link is a cosmetic bug and a javascript: link is an XSS.
 */
const ALLOWED = new Set(['http:', 'https:']);

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;

  // Control characters are stripped by the browser before the scheme is parsed,
  // so "java\nscript:alert(1)" would execute while looking harmless to us.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F]/.test(raw)) return null;

  try {
    const parsed = new URL(raw);
    if (!ALLOWED.has(parsed.protocol)) return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
