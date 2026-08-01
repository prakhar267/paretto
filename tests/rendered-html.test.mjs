import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);
const cloudflareWorkersTestModule =
  "data:text/javascript," +
  encodeURIComponent(
    [
      "export const env = {};",
      "export function waitUntil(promise) {",
      "  Promise.resolve(promise).catch(() => {});",
      "}",
    ].join("\n"),
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: cloudflareWorkersTestModule,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://localhost${pathname}`, {
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

test("server-renders the Paretto app shell and product metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);

  const html = await response.text();
  assert.match(html, /<title>Paretto — Learn French, one region at a time<\/title>/i);
  assert.match(
    html,
    /Your learning profile is temporarily unavailable/,
    "the bare server render must fail closed until the Worker supplies a scoped learner identity",
  );
  assert.match(html, /Paretto/);
  assert.match(html, /five-minute lessons, adaptive reviews/i);
  assert.match(html, /property="og:image" content="http:\/\/localhost(?::3000)?\/og-v2\.png"/i);
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
  const [page, layout, packageJson, hosting, app, errorPage, legalDocument, favicon] =
    await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/ParettoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal-document.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/favicon.svg", import.meta.url), "utf8"),
    ]);

  assert.match(page, /<ParettoApp\s+[\s\S]*storageKey=/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /Paretto/);
  assert.match(layout, /themeColor:\s*"#17233b"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(hosting, /"d1": "DB"/);
  for (const source of [app, errorPage, legalDocument]) {
    assert.doesNotMatch(source, />\s*L\s*</, "visible brand marks must use P");
    assert.doesNotMatch(source, /Loquivo/i, "current product UI must not expose the legacy brand");
  }
  assert.match(favicon, /aria-label="Paretto"/);
  assert.doesNotMatch(favicon, /Loquivo/);

  await Promise.all([
    access(new URL("../public/og-v2.png", import.meta.url)),
    access(new URL("../public/manifest.webmanifest", import.meta.url)),
    access(new URL("../public/apple-touch-icon.png", import.meta.url)),
    access(new URL("../public/audio/fr/manifest.json", import.meta.url)),
    access(new URL("../drizzle/0002_living_cassandra_nova.sql", import.meta.url)),
    assert.rejects(access(new URL("../app/_sites-preview", templateRoot))),
  ]);
});
