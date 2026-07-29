import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
const previewRoot = new URL("../app/_sites-preview/", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Jsonable application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Jsonable \| Visual JSON Editor<\/title>/i);
  assert.match(html, /文件仅在本地处理，不保存/);
  assert.match(html, /预览 JSON/);
  assert.match(html, /编辑 Lottie/);
  assert.match(html, /支持 JSON、视频、动图与多选序列帧/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /jsonable-logo-v2\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships product metadata without starter-preview leftovers", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /export default function Home\(\)/);
  assert.match(page, /"landing-hero"/);
  assert.match(layout, /title:\s*"Jsonable \| Visual JSON Editor"/);
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.doesNotMatch(page + layout + packageJson, /codex-preview|react-loading-skeleton|Starter Project/);

  await assert.rejects(access(previewRoot));
  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});
