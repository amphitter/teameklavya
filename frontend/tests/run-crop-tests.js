#!/usr/bin/env node
/**
 * Runs the crop-geometry assertions.
 *
 *   node tests/run-crop-tests.js
 *
 * `src/lib/crop.ts` has no React, DOM or package imports, so it is transpiled
 * straight from source and exercised in Node — no browser, no framework.
 */
const { execFileSync } = require("child_process");
const path = require("path");
execFileSync(process.execPath, [path.join(__dirname, "crop.test.js")], { stdio: "inherit" });
