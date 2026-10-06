/**
 * Email-domain helpers (Ownership Verification system).
 *
 * A matching institutional domain is an AFFILIATION SIGNAL only — it never
 * grants ownership or verification by itself (students have institutional
 * emails too). Official ownership always requires human review + proof.
 */

// Common consumer mailbox providers — anything else counts as institutional
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "yahoo.co.in",
  "outlook.com",
  "outlook.in",
  "hotmail.com",
  "hotmail.in",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "yandex.com",
  "yandex.ru",
  "mail.com",
  "gmx.com",
  "zoho.com",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "daum.net",
  "email.com",
  "inbox.com",
]);

/** Lower-cased domain of an email address ("" when malformed). */
function emailDomain(email) {
  const parts = String(email || "").toLowerCase().trim().split("@");
  if (parts.length !== 2 || !parts[1] || parts[1].length < 4 || !parts[1].includes(".")) return "";
  return parts[1];
}

/** True when the domain looks institutional (not a consumer mailbox provider). */
function isInstitutionalDomain(email) {
  const domain = emailDomain(email);
  return Boolean(domain) && !CONSUMER_DOMAINS.has(domain);
}

module.exports = { CONSUMER_DOMAINS, emailDomain, isInstitutionalDomain };
