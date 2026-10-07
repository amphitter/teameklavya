/**
 * EventHub URL Safety (Part 7, §27)
 * ─────────────────────────────────
 * User-supplied URLs are rendered as `href` on the frontend and interpolated
 * into emails on the backend. Both sinks are dangerous:
 *
 *   • `href={value}` with `value = "javascript:alert(document.cookie)"` is a
 *     stored XSS. React warns about this in development but still renders it.
 *   • `<a href="${value}">` inside an HTML email is HTML injection — a value
 *     containing `"><script>` breaks out of the attribute entirely.
 *
 * The rule is therefore the same at both sinks: **only http and https survive,
 * and the value is escaped on the way into HTML.** Everything else is rejected
 * at write time, so bad data never reaches a sink at all.
 *
 * `data:` and `vbscript:` are rejected explicitly rather than by omission —
 * a blocklist-by-omission silently rots the moment someone adds a scheme.
 */
"use strict";

/** Schemes that are safe to put in an href or an email body. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Normalise and validate a user-supplied external URL.
 *
 * @returns {{ok: true, url: string} | {ok: false, reason: string}}
 *          `url` is the normalised absolute URL, safe to store and render.
 *          Empty/blank input returns ok with an empty string (the field is
 *          optional — absent is different from invalid).
 */
function validateExternalUrl(value, { field = "url" } = {}) {
  if (value === undefined || value === null) return { ok: true, url: "" };

  const raw = String(value).trim();
  if (raw === "") return { ok: true, url: "" };

  // Reject control characters and whitespace inside the value outright. Browsers
  // strip these before the scheme is parsed, so "java\nscript:alert(1)" would
  // otherwise parse as javascript: and execute while looking harmless here.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F]/.test(raw)) {
    return { ok: false, reason: `${field} contains control characters` };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `${field} must be an absolute http(s) URL` };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `${field} must start with http:// or https:// (got "${parsed.protocol}")`,
    };
  }

  // A URL with no hostname is not navigable. `http://` alone parses fine.
  if (!parsed.hostname) {
    return { ok: false, reason: `${field} must include a host` };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Escape a value for interpolation into an HTML attribute.
 *
 * The email templates build HTML by string concatenation, so every
 * user-controlled value needs this. Quotes matter most: without escaping them
 * a value breaks out of the attribute and injects its own markup.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build an `<a href>` for an HTML email from a user-supplied URL.
 * Returns an empty string when the URL is absent or unsafe, so a bad value
 * degrades to "no link" instead of "injected markup".
 */
function safeEmailLink(url, text) {
  const result = validateExternalUrl(url);
  if (!result.ok || !result.url) return "";
  return `<a href="${escapeHtml(result.url)}">${escapeHtml(text || result.url)}</a>`;
}

/**
 * Express helper: validate a set of body fields and respond 400 on failure.
 * Returns true when the response has been sent (caller must stop).
 */
function rejectUnsafeUrls(req, res, fields) {
  for (const field of fields) {
    const result = validateExternalUrl(req.body?.[field], { field });
    if (!result.ok) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: result.reason },
        message: result.reason,
      });
      return true;
    }
    if (req.body[field] !== undefined) req.body[field] = result.url;
  }
  return false;
}

module.exports = {
  ALLOWED_SCHEMES,
  validateExternalUrl,
  escapeHtml,
  safeEmailLink,
  rejectUnsafeUrls,
};
