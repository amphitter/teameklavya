#!/usr/bin/env node
/**
 *   node tests/run-variant-tests.js
 *
 * `src/lib/image-variants.ts` is pure (no imports at all), so it transpiles
 * standalone and runs in Node.
 */
const { execFileSync } = require("child_process");
const path = require("path");
execFileSync(process.execPath, [path.join(__dirname, "image-variants.test.js")], { stdio: "inherit" });
