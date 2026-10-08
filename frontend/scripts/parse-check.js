#!/usr/bin/env node
/**
 * parse-check.js — fail fast when a source file cannot be parsed.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Three syntax errors once reached a production deploy and the build died on
 * Vercel after a full `npm install` + a partially progress bar:
 *
 *   events/[slug]/page.tsx  → `x Expected ',', got 'open'`
 *   profile/[id]/page.tsx   → `x Expected ',', got 'open'`
 *   quiz/[id]/page.tsx      → `x Expected '</', got '('`
 *
 * All three are single-character slips (a lost `<>` fragment line, a JSX
 * comment missing its closing `}`), and all three are reported by this script
 * in about a second — before the framework is even booted. It uses Next's own
 * SWC parser, i.e. the exact parser `next build` uses, so there are no
 * false positives: a file this script rejects is a file the build rejects.
 *
 * USAGE
 *   node scripts/parse-check.js            # every .ts/.tsx/.js/.jsx under src/
 *   node scripts/parse-check.js src/x.tsx  # just these files
 *
 * It is wired to `prebuild`, so `npm run build` and any Vercel deployment run
 * it first.
 */

const fs = require("fs");
const path = require("path");
const { parse } = require("next/dist/build/swc");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", "coverage", ".git"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function targets(argv) {
  if (argv.length) return argv.map((p) => path.resolve(p));
  const found = [];
  for (const dir of ["src", "app"]) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, found);
  }
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js", "tailwind.config.ts"]) {
    const abs = path.join(ROOT, name);
    if (fs.existsSync(abs)) found.push(abs);
  }
  return found;
}

/** SWC wants to know which dialect to read; the extension decides that. */
function optionsFor(file) {
  const ext = path.extname(file);
  const ts = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  return {
    syntax: ts ? "typescript" : "ecmascript",
    tsx: ext === ".tsx" || ext === ".jsx",
    jsx: ext === ".tsx" || ext === ".jsx",
    decorators: true,
    filename: path.relative(ROOT, file),
    // "unknown" accepts both a module and a script, so a file with no imports
    // is not rejected for the wrong reason.
    isModule: "unknown",
  };
}

(async () => {
  const files = targets(process.argv.slice(2));
  if (!files.length) {
    console.log("parse-check: nothing to check");
    return;
  }

  const failures = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    try {
      await parse(src, optionsFor(file));
    } catch (err) {
      // SWC's message carries the caret diagram; keep the position and the text.
      const lines = String(err.message).split("\n").map((l) => l.trimEnd());
      const headline = lines.find((l) => /^\s*x\s/.test(l)) || lines[0] || "parse error";
      const where = lines.find((l) => /,-\[/.test(l)) || "";
      failures.push({ file: path.relative(ROOT, file), headline: headline.trim(), where: where.trim() });
    }
  }

  if (!failures.length) {
    console.log(`parse-check: ${files.length} file${files.length === 1 ? "" : "s"} parsed clean`);
    return;
  }

  console.error(`\nparse-check: ${failures.length} file${failures.length === 1 ? "" : "s"} CANNOT BE PARSED\n`);
  for (const f of failures) {
    console.error(`  ${f.file}`);
    console.error(`    ${f.headline}${f.where ? `   ${f.where}` : ""}`);
  }
  console.error("\nFix these before building — `next build` will fail on every one of them.\n");
  process.exit(1);
})();
