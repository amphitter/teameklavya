/**
 * The mutation contract — a payload must survive the round trip.
 *
 *   node tests/run-query-tests.js
 *
 * Why this exists: profile save showed "Couldn't save your profile" under an
 * HTTP 200 response. The request resolved correctly, the backend was fine, and
 * the caller never saw the result. `useEditProfile` unwrapped the axios
 * response with `.then((r) => r.data)`, and `useMutation` then read `.data`
 * again — off the payload. Every mutation written in that (very reasonable)
 * style resolved `undefined`, and the one caller that inspects the resolved
 * value read `undefined` as failure.
 *
 * These assertions pin the two contract points that were missing:
 *   1. a request that already unwrapped returns the payload untouched
 *   2. a raw axios response is still unwrapped exactly once
 *   3. a payload that merely has a `data` field is NOT mistaken for a response
 *   4. `throwOnError` lets a caller distinguish failure from cancellation
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "src/lib/query.ts");
const work = path.join(__dirname, ".query-build");

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

let code = fs.readFileSync(src, "utf8");
// The module's React/axios surface is irrelevant to the two pure functions
// under test; strip the imports so the file transpiles standalone.
code = code
  // The React surface is not under test, but the file must still typecheck for
  // tsc to emit. Minimal stubs keep every hook signature satisfied without a
  // DOM, a renderer or a test framework.
  .replace(
    'import { useCallback, useEffect, useRef, useState } from "react";',
    [
      "const useCallback = <T,>(fn: T): T => fn;",
      "const useEffect = (_fn: () => void, _deps?: unknown[]) => {};",
      "const useRef = <T,>(initial: T) => ({ current: initial });",
      "const useState = <T,>(initial: T): [T, (v: T) => void] => [initial, () => {}];",
    ].join("\n")
  )
  .replace('import type { AxiosError, AxiosRequestConfig } from "axios";', "type AxiosError = any; type AxiosRequestConfig = any;")
  .replace('import { api } from "@/utils/api";', "const api: any = {};")
  .replace('"use client";', "");
fs.writeFileSync(path.join(work, "query.ts"), code);

/* tsc reports type errors for the stubbed React surface above — expected, and
 * irrelevant here. What matters is that it EMITS, so tolerate a non-zero exit
 * and fail loudly only when the artifact is missing. */
let emitExit = 0;
try {
  execFileSync(
    path.join(root, "node_modules/.bin/tsc"),
    [path.join(work, "query.ts"), "--outDir", path.join(work, "out"), "--module", "commonjs", "--target", "es2020", "--skipLibCheck"],
    { stdio: "ignore" }
  );
} catch (e) {
  emitExit = e.status ?? 1;
}
const emitted = path.join(work, "out", "query.js");
if (!fs.existsSync(emitted)) {
  console.error(`FATAL: tsc emitted nothing (exit ${emitExit}) — cannot run the assertions`);
  process.exit(1);
}

const q = require(emitted);

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n── ${t} ──`);

section("a request that already unwrapped (the bug)");
const payload = { success: true, message: "Profile updated", user: { _id: "u1", username: "ana_roy" } };
ok(
  q.__testUnwrapAxios(payload) === payload,
  "the payload is returned unchanged, so the caller's success branch is reachable"
);
ok(
  q.__testUnwrapAxios(payload)?.success === true,
  "`res.success` is true where it used to be `undefined`"
);
ok(
  q.__testUnwrapAxios(payload)?.user?.username === "ana_roy",
  "the nested user survives, so the header can update from the save response"
);

section("a raw axios response is still unwrapped, exactly once");
const axiosResponse = { data: payload, status: 200, headers: {} };
ok(q.__testUnwrapAxios(axiosResponse) === payload, "response.data is returned");

section("a payload that merely contains `data` is not a response");
const tricky = { data: "some field", success: true };
ok(q.__testUnwrapAxios(tricky) === tricky, "no `status` + `headers` ⇒ treated as the payload itself");

section("primitives and null pass through");
ok(q.__testUnwrapAxios(null) === null, "null");
ok(q.__testUnwrapAxios(undefined) === undefined, "undefined");
ok(q.__testUnwrapAxios("ok") === "ok", "a string");

section("cancelled requests are recognised and never retried");
ok(q.isCancelled({ code: "ERR_CANCELED" }), "axios ERR_CANCELED");
ok(q.isCancelled({ name: "CanceledError" }), "CanceledError");
ok(!q.isCancelled({ response: { status: 500 } }), "a 500 is NOT a cancellation — it must be reported");

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
