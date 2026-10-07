#!/usr/bin/env node
/**
 * Runs the query-layer assertions.
 *
 *   node tests/run-query-tests.js
 *
 * `src/lib/query.ts` is transpiled standalone (its React/axios imports are
 * stubbed) so the pure helpers can be tested without a DOM or a framework.
 * See tests/query-mutation.test.js for why these assertions exist.
 */
const { execFileSync } = require("child_process");
const path = require("path");
execFileSync(process.execPath, [path.join(__dirname, "query-mutation.test.js")], { stdio: "inherit" });
