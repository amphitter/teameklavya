#!/usr/bin/env node
/**
 * Runs the messages-store assertions.
 *
 *   node tests/run-messages-store-tests.js
 *
 * The store is plain TypeScript with no runtime dependencies (its one import
 * is `import type`), so it can be transpiled standalone and exercised in the
 * Node test runner rather than needing a DOM, a browser or a test framework.
 * That keeps the regression guards re-runnable without adding a dependency.
 *
 * What is guarded here is exactly what went wrong in the previous
 * implementation and what the spec calls out by number:
 *   §5  prepend dedupe        §10 a refetch must not eat an in-flight send
 *   §11 optimistic reconcile  §12 slice isolation
 *   §24 per-view unread/archive state
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src/lib/messages/store.ts");
const work = path.join(__dirname, ".store-build");

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

let code = fs.readFileSync(src, "utf8");
// `import type` is erased by the compiler, but the path aliases it uses are
// not resolvable outside Next. Substitute a local alias so the transpile is
// self-contained without changing any runtime behaviour.
code = code
  .replace('import type { ChatMessage } from "@/hooks/use-social";', "type ChatMessage = any;")
  .replace('"use client";', "");
const staged = path.join(work, "store.ts");
fs.writeFileSync(staged, code);

execFileSync(
  path.join(root, "node_modules/.bin/tsc"),
  [staged, "--outDir", path.join(work, "out"), "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
  { stdio: "inherit" }
);

// The assertions require the compiled output, so run them from the work dir.
const testPath = path.join(work, "run.js");
fs.copyFileSync(path.join(__dirname, "messages-store.test.js"), testPath);
execFileSync(process.execPath, [testPath], {
  cwd: work,
  stdio: "inherit",
  env: { ...process.env },
});
