#!/usr/bin/env node
/**
 * EventHub Secret Scanner (Part 7, §19)
 * ─────────────────────────────────────
 * Backups and artifacts are the quiet way credentials leak. Code gets
 * reviewed; a `tar.gz` of the deployment directory does not, and it contains
 * `.env` if `.env` was there when the archive was made.
 *
 * This scanner answers: **if this directory were shared, leaked, or restored
 * onto another machine, would it hand someone a credential?**
 *
 * USAGE
 *   node scripts/scan-secrets.js                       # scan the repo
 *   node scripts/scan-secrets.js --path /tmp/backup    # scan an extracted backup
 *   node scripts/scan-secrets.js --json report.json
 *
 * Exit 0 = clean, 1 = secrets found, 2 = usage error.
 *
 * Deliberately conservative: it would rather report five things you have to
 * wave through than miss one. A scanner that cries wolf gets disabled; one
 * that never fires also gets disabled. The middle ground is precision — hence
 * the allowlist for documentation and test fixtures, which are supposed to
 * contain example keys and must not train you to ignore output.
 */
"use strict";

const fs = require("fs");
const path = require("path");

/* ── CLI ─────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { paths: [path.join(__dirname, "..", "..")], json: null, quiet: false, maxBytes: 2 * 1024 * 1024 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--path": case "-p":
        if (!out._explicit) { out.paths = []; out._explicit = true; }
        out.paths.push(next());
        break;
      case "--json": out.json = next(); break;
      case "--quiet": out.quiet = true; break;
      case "--help": case "-h": out.help = true; break;
      default: break;
    }
  }
  return out;
}

/* ── Detection rules ─────────────────────────────────────────────────── */

/**
 * Each rule names what it catches and why it matters. The `why` is printed in
 * the report, because "secret detected" is not actionable — "this is a
 * Supabase service_role key, which bypasses RLS" is.
 */
const RULES = [
  {
    id: "ENV_FILE",
    why: "an environment file present in an artifact means every secret in it travels with the artifact",
    test: (rel) => /(^|\/)\.env(\.|$)/.test(rel) && !/\.env\.example$/.test(rel),
    byName: true,
  },
  {
    id: "PRIVATE_KEY",
    why: "a PEM private key — whoever holds it can impersonate the holder",
    // eslint-disable-next-line no-useless-escape
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "SUPABASE_SERVICE_ROLE",
    why: "Supabase service_role key — bypasses Row Level Security entirely",
    pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    refine: (m, ctx) => /service_role/i.test(ctx) || /SUPABASE_SERVICE_ROLE_KEY/i.test(ctx),
  },
  {
    id: "MONGO_URI_WITH_CREDS",
    why: "MongoDB connection string with inline credentials",
    // The host is part of the match, not just the credentials: whether a URI
    // is a fixture is decided by WHERE it points, and a match that stops at
    // the "@" carries no host to judge.
    pattern: /mongodb(?:\+srv)?:\/\/[^\s:@\/"']+:[^\s@\/"']+@[^\s\/"':]+/g,
    // Judged entirely here, not by the generic pre-check: `admin:` is a real
    // username, so a token scan over the whole URI misfires. The host decides
    // whether it is a fixture; the password decides whether it is generated.
    skipTestValueCheck: true,
    refine: (m) => !isFixtureUri(m) && looksGenerated(uriPassword(m), 8),
  },
  {
    id: "REDIS_URL_WITH_CREDS",
    why: "Redis URL containing a password or token",
    pattern: /rediss?:\/\/[^\s:@\/"']*:[^\s@\/"']+@[^\s\/"':]+/g,
    skipTestValueCheck: true,
    refine: (m) => !isFixtureUri(m) && looksGenerated(uriPassword(m), 8),
  },
  {
    id: "AWS_ACCESS_KEY",
    why: "AWS access key id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "STRIPE_KEY",
    why: "Stripe secret or publishable key",
    pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: "GENERIC_ASSIGNED_SECRET",
    why: "a variable that names itself a secret and is assigned a literal value",
    pattern: /(?:SECRET|PASSWORD|API_KEY|ACCESS_TOKEN|PRIVATE_KEY|CLIENT_SECRET)\s*[:=]\s*["'][^"'\s${}]{12,}["']/gi,
    // Judge the VALUE, not the assignment. Scoring `SECRET = "test-secret"`
    // as a whole inflates the entropy with the variable name and punctuation,
    // which is how obvious fixtures came back looking generated.
    //
    // Named `extract`, NOT `valueOf`: every object inherits `valueOf` from
    // Object.prototype, so `rule.valueOf ? ...` is always truthy and calling
    // it boxes the value into an object. That cost a while to find.
    extract: (m) => (m.match(/["']([^"']*)["']/) || [null, m])[1],
  },
];

/* ── What to skip ────────────────────────────────────────────────────── */

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage",
  ".cache", ".turbo", "out", "target", "__pycache__",
]);

const SKIP_FILES = new Set([".env.example", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
  ".gz", ".tgz", ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".webm",
  ".so", ".dylib", ".dll", ".exe", ".bin",
]);

/**
 * Documentation and fixtures legitimately contain fake keys. They are checked
 * against an allowlist of known-safe example values rather than skipped
 * outright, so that a REAL key pasted into a README still gets caught.
 */
const EXAMPLE_VALUES = new Set([
  "test-secret", "your-secret", "changeme", "example", "placeholder",
  "xxxxxxxx", "redacted", "none", "null", "undefined", "todo",
]);


/**
 * Is this value obviously a test fixture rather than a credential?
 *
 * A scanner that flags `password = "test-secret"` five times trains whoever
 * runs it to scroll past the output — and the sixth finding might be real.
 * Precision is not a nicety here; it is the difference between a control that
 * works and one that gets disabled.
 *
 * Two signals, either of which clears the value:
 *   1. it contains a word that only ever appears in fixtures
 *   2. its entropy is too low to be a generated credential
 */
const TEST_VALUE_TOKENS = [
  "test", "example", "dummy", "fake", "sample", "placeholder", "changeme",
  "localhost", "127.0.0.1", "demo", "foo", "bar", "baz", "scale",
  "secret", "password", "passwd", "pwd", "admin", "user", "default", "mock",
];

/** Shannon entropy in bits per character. */
function entropy(str) {
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / str.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Real credentials are generated: long, mixed-class, high entropy.
 * `test-secret` (0.9 bits/char) is not; a Supabase service key is (~5.5).
 */
function looksGenerated(value, minLength = 16) {
  const v = String(value);
  if (v.length < minLength) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
  return classes >= 2 && entropy(v) >= 3.2;
}

/**
 * Words that mark a value as a fixture no matter what else is true. These
 * appear in documentation samples and nowhere in a real credential.
 */
const STRONG_FIXTURE_TOKENS = ["example", "dummy", "fake", "placeholder", "changeme", "sample", "mock"];

function looksLikeTestValue(value) {
  const str = String(value);
  const v = str.toLowerCase();
  if (EXAMPLE_VALUES.has(v)) return true;
  // `process.env.X` reads are not secrets, they are the absence of one.
  if (/^\$\{?\w*\}?$/.test(str.trim()) || /^process\.env/.test(str)) return true;
  if (isFixtureUri(str)) return true;

  const strong = STRONG_FIXTURE_TOKENS.some((t) => v.includes(t));
  if (strong) return true;

  /* Order matters here. The remaining tokens — admin, user, password,
     default — are all things a REAL credential legitimately contains:
     a Mongo URI whose username is `admin` and whose password is 32 random
     characters is a production string that happens to say "admin". So a weak
     token only clears the value when the value does not look generated. */
  /* Tokens win. A value that calls itself a password, names a test, or reads
     like documentation is a fixture even if it is long — and a real generated
     credential does not contain readable words. */
  /* A long, high-entropy value is a generated credential, full stop. Random
     base64 contains "bar" or "test" by accident often enough that substring
     token matching must not apply to it — that is how a real JWT was being
     waved through as a fixture. */
  const gen = looksGenerated(str);
  if (gen && str.length >= 32) return false;

  const weak = TEST_VALUE_TOKENS.some((t) => v.includes(t));
  return weak || !gen;
}


/**
 * Pull the host out of a connection string.
 *
 * Whether a URI is a credential depends on WHERE it points: `u:pw@cluster0.
 * mongodb.net` is production, `u:pw@cluster.example.net` is a fixture. The
 * password can be identical in both, so the host is the deciding signal and
 * checking the whole match just muddies it.
 */
function uriHost(value) {
  const m = String(value).match(/@([^\/:"'\s]+)/);
  return m ? m[1].toLowerCase() : "";
}

/** Pull the password out of a connection string — the part that is the secret. */
function uriPassword(value) {
  const m = String(value).match(/:([^:@\/"'\s]+)@/);
  return m ? m[1] : "";
}

/** Hosts that only ever appear in fixtures. */
const FIXTURE_HOSTS = /(^|\.)(example|test|invalid|localhost)(\.|$)|127\.0\.0\.1|^\[?::1\]?$/;

function isFixtureUri(value) {
  const str = String(value);
  // Only URIs get this treatment. Returning true for "no host found" would
  // silently clear every non-URI secret — an API key has no @ either.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) return false;
  const host = uriHost(str);
  // An unparseable host is NOT assumed to be a fixture — when in doubt, report.
  if (host === "") return false;
  return FIXTURE_HOSTS.test(host);
}

/* ── Scanner ─────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file, root) {
  const rel = path.relative(root, file);
  const base = path.basename(file);
  if (SKIP_FILES.has(base)) return [];
  if (SKIP_EXT.has(path.extname(file).toLowerCase())) return [];

  const findings = [];

  // Name-based rules first — a .env is a finding whatever it contains.
  for (const rule of RULES) {
    if (rule.byName && rule.test(rel)) {
      findings.push({ file: rel, rule: rule.id, why: rule.why, match: base, line: null });
    }
  }

  let stat;
  try { stat = fs.statSync(file); } catch { return findings; }
  if (stat.size > 4 * 1024 * 1024) return findings; // skip very large files

  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return findings; }

  // NUL bytes mean binary; scanning it produces noise, not findings.
  if (text.includes("\0")) return findings;

  const lines = text.split("\n");
  for (const rule of RULES) {
    if (!rule.pattern) continue;
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(text)) !== null) {
      const value = m[0];
      // Fixtures and placeholders are not findings. Each rule decides which
      // substring is the actual secret — see valueOf / skipTestValueCheck.
      if (!rule.skipTestValueCheck) {
        const subject = rule.extract ? rule.extract(value) : value;
        if (looksLikeTestValue(subject)) continue;
      }

      // Rules that can over-match get a refinement pass using the line
      // they were found on, so context decides.
      let lineNo = null;
      let lineText = "";
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(value)) { lineNo = i + 1; lineText = lines[i]; break; }
      }
      if (rule.refine && !rule.refine(value, lineText)) continue;

      findings.push({
        file: rel,
        rule: rule.id,
        why: rule.why,
        line: lineNo,
        // Never print the secret itself. A scanner that echoes the credential
        // into CI logs has leaked the very thing it was meant to protect.
        match: `${value.slice(0, 6)}…(${value.length} chars) REDACTED`,
      });
    }
  }
  return findings;
}

/* ── Main ────────────────────────────────────────────────────────────── */

(function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(`
EventHub Secret Scanner (Part 7, §19)

  node scripts/scan-secrets.js [--path DIR]... [--json FILE] [--quiet]

Scans for credentials that would travel with a backup or artifact: .env files,
private keys, service-role tokens, connection strings with inline passwords.

Never prints the secret itself — only its kind, location and length.
Exit: 0 = clean, 1 = findings, 2 = usage error.
`);
    process.exit(0);
  }

  const all = [];
  for (const p of opts.paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      console.error(`  path does not exist: ${abs}`);
      process.exit(2);
    }
    const st = fs.statSync(abs);
    const files = st.isDirectory() ? walk(abs) : [abs];
    const root = st.isDirectory() ? abs : path.dirname(abs);
    for (const f of files) {
      try { all.push(...scanFile(f, root)); } catch { /* unreadable — skip */ }
    }
  }

  const byRule = {};
  for (const f of all) byRule[f.rule] = (byRule[f.rule] || 0) + 1;

  if (!opts.quiet) {
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  SECRET SCAN");
    console.log("══════════════════════════════════════════════════════════════");
    if (!all.length) {
      console.log("  ✅ no secrets found");
    } else {
      for (const f of all) {
        console.log(`  ❌ ${f.rule}  ${f.file}${f.line ? `:${f.line}` : ""}`);
        console.log(`       ${f.match}`);
        console.log(`       → ${f.why}`);
      }
    }
    console.log("\n  summary: " + (Object.keys(byRule).length
      ? Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join(", ")
      : "clean"));
    console.log("══════════════════════════════════════════════════════════════\n");
  }

  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({ findings: all, byRule }, null, 2));
  }

  process.exit(all.length ? 1 : 0);
})();
