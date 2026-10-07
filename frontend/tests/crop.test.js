#!/usr/bin/env node
/**
 * Crop geometry — the maths that decides what ends up inside someone's avatar.
 *
 *   node tests/run-crop-tests.js
 *
 * `src/lib/crop.ts` is deliberately pure (no React, no DOM, no imports), so it
 * transpiles standalone. That matters here more than usual: this is the code
 * that guarantees every device shows the same composition, and a regression in
 * it is invisible until someone's face is cropped wrong on their phone.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const work = path.join(__dirname, ".crop-build");

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
fs.copyFileSync(path.join(root, "src/lib/crop.ts"), path.join(work, "crop.ts"));

execFileSync(
  path.join(root, "node_modules/.bin/tsc"),
  [path.join(work, "crop.ts"), "--outDir", path.join(work, "out"), "--module", "commonjs", "--target", "es2020", "--strict"],
  { stdio: "inherit" }
);

const crop = require(path.join(work, "out", "crop.js"));

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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const section = (t) => console.log(`\n── ${t} ──`);

/* A tall portrait phone photo — the case that produced "only a nose is
 * visible": a 1200×1600 image in a square frame. */
const P = { iw: 1200, ih: 1600, box: 400 };

section("cover scale");
const base = crop.coverScale(1200, 1600, 400, 400);
ok(near(base, 400 / 1200, 0.0001), "a portrait image is scaled by its WIDTH to cover a square", `got ${base}`);
const wide = crop.coverScale(1600, 400, 400, 400);
ok(near(wide, 400 / 400, 0.0001), "a landscape image is scaled by its HEIGHT to cover a square", `got ${wide}`);

section("the identity view is centred and full-width");
const identity = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base, offset: { x: 0, y: 0 }, boxW: P.box, boxH: P.box,
});
ok(near(identity.sw, 1200), "the window spans the full source width", `sw=${identity.sw}`);
ok(near(identity.sx, 0), "so it starts at x=0");
ok(near(identity.sh, 1200), "and is as tall as it is wide (square)", `sh=${identity.sh}`);
ok(near(identity.sy, 200), "centred vertically: (1600-1200)/2 = 200", `sy=${identity.sy}`);

section("panning is clamped — the frame can never show past an edge");
/* Offsets are in CSS pixels (what a pointer produces), so the pan room is the
 * displayed overflow, not the source overflow: at base scale the image is
 * 400×533 CSS, i.e. 133 CSS taller than the frame, so 66.67 px each way. The
 * equivalent in SOURCE pixels is 200 — the same edge, two units. */
const limits = crop.offsetLimits(P.iw, P.ih, base, P.box, P.box);
ok(near(limits.maxX, 0), "a portrait image has no horizontal room to pan", `maxX=${limits.maxX}`);
ok(near(limits.maxY, 66.67), "and 66.67 CSS px of vertical room (200 source px)", `maxY=${limits.maxY}`);
const pushed = crop.clampOffset({ x: 999, y: 999 }, P.iw, P.ih, base, P.box, P.box);
ok(near(pushed.x, 0) && near(pushed.y, 66.67), "an absurd drag clamps to the limit, not past it", JSON.stringify(pushed));
const topEdge = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base, offset: pushed, boxW: P.box, boxH: P.box,
});
ok(near(topEdge.sy, 0), "dragging to the top limit puts the window at the very top", `sy=${topEdge.sy}`);
ok(near(topEdge.sy + topEdge.sh, 1200), "…and the window's bottom is exactly 1200");

section("zoom");
const zoomed = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base * 2, offset: { x: 0, y: 0 }, boxW: P.box, boxH: P.box,
});
ok(near(zoomed.sw, 600), "2× zoom shows half the width", `sw=${zoomed.sw}`);
ok(near(zoomed.sh, 600), "and half the height", `sh=${zoomed.sh}`);
ok(crop.clampZoom(99) === 4 && crop.clampZoom(0.1) === 1, "zoom is bounded to 1–4");

section("the stored crop round-trips exactly");
const stored = crop.normalizedFromSourceRect(identity, P.iw, P.ih);
ok(near(stored.w, 1) && near(stored.x, 0), "a full-width crop stores w=1, x=0");
ok(near(stored.y, 0.125) && near(stored.h, 0.75), "and y=0.125, h=0.75", JSON.stringify(stored));
const reopened = crop.viewFromNormalized(stored, P.iw, P.ih, P.box, P.box);
const again = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base * reopened.zoom, offset: reopened.offset, boxW: P.box, boxH: P.box,
});
ok(near(again.sx, identity.sx) && near(again.sy, identity.sy), "re-opening the editor restores the same position", `${again.sy} vs ${identity.sy}`);
ok(near(again.sw, identity.sw) && near(again.sh, identity.sh), "…and the same zoom", `${again.sw} vs ${identity.sw}`);

section("…and the same composition after a pan");
const panned = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base * 1.7,
  offset: crop.clampOffset({ x: 30, y: -140 }, P.iw, P.ih, base * 1.7, P.box, P.box),
  boxW: P.box, boxH: P.box,
});
const pannedCrop = crop.normalizedFromSourceRect(panned, P.iw, P.ih);
const pannedView = crop.viewFromNormalized(pannedCrop, P.iw, P.ih, P.box, P.box);
const pannedAgain = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: base * pannedView.zoom, offset: pannedView.offset, boxW: P.box, boxH: P.box,
});
ok(
  near(pannedAgain.sx, panned.sx, 1) && near(pannedAgain.sy, panned.sy, 1),
  "a panned + zoomed crop re-opens pixel-for-pixel",
  `${JSON.stringify(panned)} vs ${JSON.stringify(pannedAgain)}`
);

section("frame aspect does not change the source window's meaning");
// The editor's frame may be any size (a 320px phone, a 520px desktop) — the
// stored crop is a fraction, so the result must be identical at any frame size.
const small = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: crop.coverScale(P.iw, P.ih, 288, 288),
  offset: { x: 0, y: -100 }, boxW: 288, boxH: 288,
});
const large = crop.sourceRectFromView({
  iw: P.iw, ih: P.ih, effectiveScale: crop.coverScale(P.iw, P.ih, 520, 520),
  offset: { x: 0, y: -180.555 }, boxW: 520, boxH: 520,
});
const sNorm = crop.normalizedFromSourceRect(small, P.iw, P.ih);
const lNorm = crop.normalizedFromSourceRect(large, P.iw, P.ih);
ok(near(sNorm.w, 1) && near(lNorm.w, 1), "both frames crop the full width of a portrait photo");
ok(near(sNorm.h, lNorm.h, 0.001), "and the same fraction of its height", `${sNorm.h} vs ${lNorm.h}`);

section("banner focal point");
ok(crop.focalYFromNormalized({ x: 0, y: 0, w: 1, h: 1 }) === 50, "a full-image cover sits at 50%");
ok(crop.focalYFromNormalized({ x: 0, y: 0, w: 1, h: 0.4 }) === 20, "a crop at the top anchors at 20%");
ok(crop.focalYFromNormalized({ x: 0, y: 0.75, w: 1, h: 0.25 }) === 88, "a crop at the bottom anchors near the bottom");

section("degenerate input is survivable");
ok(crop.coverScale(0, 0, 400, 400) === 1, "zero-sized source does not divide by zero");
const empty = crop.viewFromNormalized({ x: 0, y: 0, w: 0, h: 0 }, P.iw, P.ih, P.box, P.box);
ok(empty.zoom === 1 && empty.offset.x === 0, "an empty stored crop falls back to the identity view");

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
