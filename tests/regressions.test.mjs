import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("3D guide scenes transition without flattening ancestors", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");
  const wrappers = css.match(/\.sequence-rig-fade,\.scatter-fade\s*\{[^}]+\}/)?.[0] ?? "";
  const assembled = css.match(/\.sequence-rig-fade\s*\{[^}]+\}/)?.[0] ?? "";
  const scattered = css.match(/\.scatter-cube\s*\{[^}]+\}/)?.[0] ?? "";

  assert.match(wrappers, /transform-style:preserve-3d/);
  assert.doesNotMatch(wrappers, /\bopacity\s*:/);
  assert.match(assembled, /transition:transform \.68s/);
  assert.match(scattered, /visibility:hidden/);
  assert.match(scattered, /scale\(\.52\)/);
  assert.doesNotMatch(scattered, /scale\(\.00/);
  assert.match(css, /\.sequence-step-2 \.scatter-cube\s*\{[^}]*scale\(\.68\)/);
  assert.match(css, /\.scatter-face\s*\{[^}]*opacity:0[^}]*opacity \.52s/);
  assert.match(css, /\.sequence-step-2 \.scatter-face\s*\{\s*opacity:1/);
  assert.doesNotMatch(css, /\.sequence-step-2 \.sequence-rig-fade\s*\{[^}]*opacity/);
  assert.match(css, /\.sequence-step-2 \.sequence-rig-fade\s*\{[^}]*scale\(\.72\)[^}]*visibility 0s linear \.52s/);
  assert.doesNotMatch(css, /\.sequence-step-2 \.sequence-rig-fade\s*\{[^}]*scale\(\.0/);
  assert.match(css, /\.cubie-face\s*\{[^}]*transition:opacity \.52s/);
  assert.match(css, /\.sequence-step-2 \.cubie-face\s*\{\s*opacity:0/);
});

test("custom sampling keeps the JSON download action pinned outside scrollable content", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  const workListIndex = page.indexOf('className="result-work-list"');
  const actionsIndex = page.indexOf('data-testid={`${mode}-download-actions`}');

  assert.ok(workListIndex >= 0 && actionsIndex > workListIndex);
  assert.match(page, /确认并下载 JSON/);
  assert.match(page, /data-testid=\{`\$\{mode\}-download-json`\}/);
  assert.match(css, /\.result-work-list\s*\{[^}]*flex:1[^}]*overflow:auto/);
  assert.match(css, /\.result-downloads\s*\{[^}]*flex:0 0 56px[^}]*z-index:10/);
});

test("every scattered cube owns its color-change interaction", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.doesNotMatch(page, /selectNearestScatter/);
  assert.doesNotMatch(page, /scatter-hit-layer|className="scatter-hit"/);
  assert.match(page, /<button[\s\S]*?className="scatter-cube"[\s\S]*?data-scatter-index=\{index\}/);
  assert.match(page, /if \(step === 2\) randomizeScatterColor\(index\)/);
  assert.match(page, /querySelector<HTMLElement>\("\.scatter-front"\)/);
  assert.match(page, /Math\.hypot\(clientX - centerX, clientY - centerY\)/);
  assert.match(page, /selectedDistance <= 64/);
  assert.match(page, /activateScatterAtPoint\(event\.clientX, event\.clientY\)/);
  assert.match(css, /\.sequence-step-2 \.scatter-cube\s*\{[^}]*pointer-events:auto/);
  assert.match(css, /\.sequence-step-2 \.scatter-interaction-layer\s*\{[^}]*pointer-events:auto/);
  assert.doesNotMatch(css, /\.scatter-hit(?:-layer)?\s*\{/);
});

test("the landing page exposes only one upload action", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /\{hasUploadedFile && <button className="button button-ghost action-button"[\s\S]*?"更换文件"/);
  assert.doesNotMatch(page, /hasUploadedFile \? "更换文件" : "上传文件"/);
  assert.match(page, /mediaConverting \? "正在转换媒体\.\.\." : "选择文件"/);
});

test("selected easing curves highlight their associated Lottie elements", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /function lottieDataWithMotionHighlights/);
  assert.match(page, /object\.cl = \[existingClass, "jsonable-motion-highlight"\]/);
  assert.match(page, /highlightElementIds=\{motionHighlightElementIds\}/);
  assert.match(page, /视觉中发光的素材为当前关联元素/);
  assert.match(page, /className="easing-element-name"/);
  assert.match(css, /\.lottie-stage \.jsonable-motion-highlight/);
  assert.match(css, /\.motion-highlight-label/);
});

test("brand logo respects the GitHub Pages base path", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /const PUBLIC_BASE_PATH = process\.env\.NEXT_PUBLIC_BASE_PATH \|\| ""/);
  assert.match(page, /src=\{`\$\{PUBLIC_BASE_PATH\}\/jsonable-logo-v2\.png`\}/);
  assert.doesNotMatch(page, /src="\/jsonable-logo-v2\.png"/);
});

test("shape replacement preview uses a light inspection surface", async () => {
  const css = await readFile(new URL("app/globals.css", root), "utf8");

  assert.match(css, /\.composed-current \.shape-thumb\s*\{\s*background:#eef3f1/);
  assert.doesNotMatch(css, /\.composed-current \.shape-thumb,\.current-image-preview\s*\{\s*background:#202926/);
});
