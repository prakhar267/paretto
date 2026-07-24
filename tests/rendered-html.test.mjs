import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: {
        accept: "text/html",
        host: "localhost",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      DB: {
        prepare() {
          throw new Error("Database should not be read during the app-shell render");
        },
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Pas à Pas app shell and product metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);

  const html = await response.text();
  assert.match(html, /<title>Pas à Pas — Learn French, one region at a time<\/title>/i);
  assert.match(html, /Opening your travel journal/);
  assert.match(html, /Pas à Pas/);
  assert.match(html, /five-minute lessons, adaptive reviews/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("renders every public legal, attribution, and support route", async () => {
  const routes = [
    ["/privacy", /A useful learning record/i],
    ["/terms", /A fair agreement/i],
    ["/cookies", /No advertising trackers/i],
    ["/accessibility", /French practice should work/i],
    ["/attributions", /tools and open materials/i],
    ["/support", /Tell us what is getting in the way/i],
  ];

  for (const [pathname, title] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.match(html, title);
    assert.match(
      html,
      /25\/38 Kaveri Path, Mansarovar, Jaipur, Rajasthan, India/,
      `${pathname} must publish the operator contact address`,
    );
    if (pathname === "/terms") {
      assert.match(html, /governed by the laws of India/i);
      assert.match(html, /courts in Jaipur, Rajasthan/i);
    }
  }
});

test("removes the disposable starter surface and keeps production metadata", async () => {
  const [page, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<PasAPasApp\s+[\s\S]*storageKey=/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /Pas à Pas/);
  assert.match(layout, /themeColor:\s*"#17233b"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(hosting, /"d1": "DB"/);

  await Promise.all([
    access(new URL("../public/og.png", import.meta.url)),
    access(new URL("../public/manifest.webmanifest", import.meta.url)),
    access(new URL("../public/apple-touch-icon.png", import.meta.url)),
    access(new URL("../public/audio/fr/manifest.json", import.meta.url)),
    access(new URL("../drizzle/0002_living_cassandra_nova.sql", import.meta.url)),
    assert.rejects(access(new URL("../app/_sites-preview", templateRoot))),
  ]);
});
