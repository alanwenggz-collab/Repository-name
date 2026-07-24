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
  assert.match(scattered, /scale\(\.001\)/);
  assert.match(css, /\.sequence-step-2 \.scatter-cube\s*\{[^}]*scale\(\.68\)/);
  assert.doesNotMatch(css, /\.sequence-step-2 \.sequence-rig-fade\s*\{[^}]*opacity/);
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

