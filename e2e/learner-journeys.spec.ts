import {
  expect,
  test,
  type Page,
  type TestInfo,
} from "@playwright/test";
import axe from "axe-core";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { extname, resolve } from "node:path";

const LOCAL_AUTH_PASSWORD = "Paretto-e2e-only-passphrase-2026";
const LOCAL_AUTH_ACCOUNTS: Record<
  string,
  { email: string; name: string }
> = {
  chromium: {
    email: "chromium@e2e.paretto.invalid",
    name: "Chromium Learner",
  },
  firefox: {
    email: "firefox@e2e.paretto.invalid",
    name: "Firefox Learner",
  },
  webkit: {
    email: "webkit@e2e.paretto.invalid",
    name: "WebKit Learner",
  },
};

const FIRST_LESSON_TRANSLATIONS = new Map([
  ["le métro", "the metro / subway"],
  ["un musée", "a museum"],
  ["la banlieue", "the suburbs"],
  ["se dépêcher", "to hurry"],
  ["animé", "lively / bustling"],
]);

async function beginAsNewLearner(page: Page, name = "Ari") {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Learn French,\s*one region at a time/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Begin the journey/i }).click();
  await page.getByLabel("What should we call you?").fill(name);
  await page.getByRole("button", { name: /Start with Paris basics/i }).click();
  await expect(
    page.getByRole("heading", { name: "Your French is going places." }),
  ).toBeVisible();
  await expectCloudSave(page);
}

async function completeCurrentLesson(
  page: Page,
  startButtonName: RegExp,
): Promise<string[]> {
  await page.getByRole("button", { name: startButtonName }).first().click();
  const lesson = page.getByRole("dialog");
  await expect(lesson).toBeVisible();
  const learnedWords: string[] = [];

  for (let card = 1; card <= 5; card += 1) {
    await expect(lesson.getByText(`${card} / 5`)).toBeVisible();
    const french = (await lesson.locator("h1[lang=fr]").innerText()).trim();
    learnedWords.push(french);
    await lesson.getByRole("button", { name: "Reveal the card" }).click();
    await lesson.getByRole("button", { name: "Got it" }).click();
  }

  await expect(
    lesson.getByRole("heading", { name: /Très bien,/ }),
  ).toBeVisible();
  await lesson.getByRole("button", { name: /Back to today/i }).click();
  await expect(lesson).toBeHidden();
  await expectCloudSave(page);
  return learnedWords;
}

async function expectCloudSave(page: Page) {
  await expect(page.locator(".stats-bar .sync-pill")).toContainText("Saved", {
    timeout: 20_000,
  });
}

async function navigate(page: Page, label: "Review" | "Wordbook") {
  await page
    .getByRole("button", { name: label, exact: true })
    .first()
    .click();
}

async function openProfile(page: Page, displayName: string) {
  await page
    .getByRole("button", {
      name: new RegExp(`${escapeRegExp(displayName)}\\s+Level \\d+ traveler`),
    })
    .click();
  await expect(
    page.getByRole("heading", { name: displayName, exact: true }),
  ).toBeVisible();
}

async function signInWithSeededAccount(
  page: Page,
  account: { email: string },
) {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Keep every word with you." }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(LOCAL_AUTH_PASSWORD);
  await page
    .getByRole("button", { name: "Sign in and connect progress" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your French is going places." }),
  ).toBeVisible({ timeout: 30_000 });
  await expectCloudSave(page);
}

async function answerCurrentChallengeQuestion(
  challenge: ReturnType<Page["getByRole"]>,
) {
  const frenchWithQuotes = (
    await challenge.locator("h2 span[lang=fr]").innerText()
  ).trim();
  const french = frenchWithQuotes.replace(/[“”]/g, "");
  const answer = FIRST_LESSON_TRANSLATIONS.get(french);
  expect(answer, `Missing deterministic answer for ${french}`).toBeTruthy();
  await challenge
    .getByRole("button", { name: answer!, exact: true })
    .click();
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  // Audit the stable view rather than sampling the 280 ms page-entry fade at
  // partial opacity, which produces transient false color-contrast failures.
  await page.evaluate(async () => {
    const pageEnter = document.querySelector(".page-enter");
    await Promise.all(
      (pageEnter?.getAnimations() ?? []).map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: [
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
          "wcag22aa",
        ],
      },
    });
    return results.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target),
      }));
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test("the local TLS boundary preserves a secure origin and survives a plaintext probe", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    "This regression targets the disposable local TLS runtime.",
  );
  const requestedURLs: string[] = [];
  page.on("request", (request) => requestedURLs.push(request.url()));

  await page.goto("/");
  const transport = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    origin: window.location.origin,
    assetURLs: Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
      ),
      (link) => link.href,
    ),
    openGraphURL:
      document
        .querySelector<HTMLMetaElement>('meta[property="og:url"]')
        ?.content ?? "",
  }));
  expect(transport.secureContext).toBe(true);
  expect(transport.origin).toBe("https://localhost:4173");
  expect(transport.assetURLs.length).toBeGreaterThanOrEqual(3);
  expect(
    transport.assetURLs.every((url) => url.startsWith(`${transport.origin}/`)),
  ).toBe(true);
  expect(transport.openGraphURL).toBe(`${transport.origin}/`);
  expect(
    requestedURLs.filter((url) => url.startsWith("http://")),
  ).toEqual([]);

  await sendPlaintextProbe("localhost", 4173);
  const health = await page.request.get("/api/health");
  expect([200, 503]).toContain(health.status());
  await expect(health.json()).resolves.toMatchObject({
    status: expect.stringMatching(/^(ok|degraded)$/),
    service: "paretto-web",
    schemaRevision: "0012",
  });
  const cachedHealth = await page.request.get("/api/health");
  expect(cachedHealth.status()).toBe(health.status());
  await expect(cachedHealth.json()).resolves.toMatchObject({
    status: expect.stringMatching(/^(ok|degraded)$/),
    service: "paretto-web",
    schemaRevision: "0012",
  });
});

test("a new learner completes the first five-card lesson", async ({ page }) => {
  await beginAsNewLearner(page, "Camille");

  const startLesson = page
    .getByRole("button", { name: /Start lesson 1/i })
    .first();
  await startLesson.focus();
  await page.keyboard.press("Enter");

  const lesson = page.getByRole("dialog");
  await expect(lesson).toBeVisible();
  await expect(lesson.locator("h1[lang=fr]")).toBeFocused();

  for (let card = 1; card <= 5; card += 1) {
    await expect(lesson.getByText(`${card} / 5`)).toBeVisible();
    await lesson.getByRole("button", { name: "Reveal the card" }).click();
    await lesson.getByRole("button", { name: /Got it/i }).click();
  }

  const completionHeading = lesson.getByRole("heading", {
    name: "Très bien, Camille.",
  });
  await expect(completionHeading).toBeVisible();
  await expect(completionHeading).toBeFocused();
  await expect(lesson.getByText(/recalled 5 of 5/i)).toBeVisible();

  await lesson.getByRole("button", { name: /Back to today/i }).click();
  await expect(lesson).toBeHidden();
  const continueLesson = page
    .getByRole("button", { name: /Continue lesson 2/i })
    .first();
  await expect(continueLesson).toBeVisible();
});

test("pre-onboarding information stays reachable and setup moves focus", async ({
  page,
}) => {
  await page.goto("/");
  const productInformation = page.getByRole("navigation", {
    name: "Product information",
  });
  for (const label of [
    "Sign in",
    "Privacy",
    "Terms",
    "Cookies & storage",
    "Accessibility",
    "Attributions",
    "Support",
  ]) {
    await expect(
      productInformation.getByRole("link", { name: label }),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Begin the journey" }).click();
  await expect(
    page.getByRole("heading", { name: "Your first stop" }),
  ).toBeFocused();
  await expect(
    page
      .getByRole("navigation", { name: "Product information" })
      .getByRole("link", { name: "Support" }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("learned-card practice, challenge attempts, dice receipts, wordbook, and backup restore are durable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // The production dice has six equal outcomes. Pinning the random source
    // makes this acceptance journey verify the persisted receipt exactly.
    Math.random = () => 0;
  });
  const displayName = "Journey Learner";
  await beginAsNewLearner(page, displayName);
  const learnedWords = await completeCurrentLesson(
    page,
    /Start lesson 1/i,
  );
  expect(new Set(learnedWords)).toEqual(
    new Set(FIRST_LESSON_TRANSLATIONS.keys()),
  );

  await page.getByRole("button", { name: "Practice anyway" }).click();
  const practice = page.getByRole("dialog");
  for (let card = 1; card <= 5; card += 1) {
    await expect(practice.getByText(`${card} / 5`)).toBeVisible();
    await expect(practice.getByText("Mixed recall")).toBeVisible();
    const practicedWord = (
      await practice.locator("h1[lang=fr]").innerText()
    ).trim();
    expect(learnedWords).toContain(practicedWord);
    await practice
      .getByRole("button", { name: "Reveal the card" })
      .click();
    await practice.getByRole("button", { name: "Got it" }).click();
  }
  await expect(
    practice.getByRole("heading", { name: `Très bien, ${displayName}.` }),
  ).toBeFocused();
  await practice
    .getByRole("button", { name: "Back to today" })
    .click();
  await expectCloudSave(page);

  await navigate(page, "Review");
  await page.getByRole("button", { name: "Begin challenge" }).click();
  let challenge = page.getByRole("dialog");
  await expect(challenge.getByText("Question 1 of 5")).toBeVisible();
  await answerCurrentChallengeQuestion(challenge);
  await challenge.getByRole("button", { name: "Close challenge" }).click();
  await expect(challenge).toBeHidden();

  // An abandoned attempt must not consume the once-daily reward or mutate
  // review schedules. Reopening starts the same deterministic first prompt.
  await expect(
    page.getByRole("button", { name: "Begin challenge" }),
  ).toBeVisible();
  await expect(page.getByText("Ready · 5 learned words")).toBeVisible();
  await page.getByRole("button", { name: "Begin challenge" }).click();
  challenge = page.getByRole("dialog");
  for (let question = 1; question <= 5; question += 1) {
    await expect(
      challenge.getByText(`Question ${question} of 5`),
    ).toBeVisible();
    await answerCurrentChallengeQuestion(challenge);
    await challenge
      .getByRole("button", {
        name: question === 5 ? "See result" : "Next question",
      })
      .click();
  }
  const challengeCompletion = challenge.getByRole("heading", {
    name: "Mission complete.",
  });
  await expect(challengeCompletion).toBeVisible();
  await expect(challengeCompletion).toBeFocused();
  await expect(challenge.getByText(/\+\d+ XP · \+\d+ coins?/)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await challenge
    .getByRole("button", { name: "Return to practice" })
    .click();
  await expect(page.getByText("Completed today · practice is reward-free")).toBeVisible();
  await expectCloudSave(page);

  await page.getByRole("button", { name: "Open the dice" }).click();
  let dice = page.getByRole("dialog");
  await dice.getByRole("button", { name: "Roll the dice" }).click();
  await expect(dice.getByText("0.5×")).toBeVisible();
  await expect(dice.getByRole("heading", { name: "+6 XP" })).toBeVisible();
  await expect(
    dice.getByText("Your 1 travel coin turned into a memory boost."),
  ).toBeVisible();
  await dice.getByRole("button", { name: "Collect reward" }).click();
  await expectCloudSave(page);
  await page
    .getByRole("button", { name: "See today’s result" })
    .click();
  dice = page.getByRole("dialog");
  await expect(dice.getByText("0.5×")).toBeVisible();
  await expect(dice.getByRole("heading", { name: "+6 XP" })).toBeVisible();
  await dice.getByRole("button", { name: "Collect reward" }).click();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your French is going places." }),
  ).toBeVisible();
  await navigate(page, "Review");
  await page
    .getByRole("button", { name: "See today’s result" })
    .click();
  dice = page.getByRole("dialog");
  await expect(dice.getByText("0.5×")).toBeVisible();
  await expect(dice.getByRole("heading", { name: "+6 XP" })).toBeVisible();
  await dice.getByRole("button", { name: "Collect reward" }).click();

  await navigate(page, "Wordbook");
  await page.getByLabel("Search the wordbook").fill("metro");
  const metroRow = page.getByRole("button", {
    name: /le métro.*the metro \/ subway/i,
  });
  await expect(metroRow).toBeVisible();
  await metroRow.click();
  const word = page.getByRole("dialog");
  await expect(
    word.getByRole("heading", { name: "le métro" }),
  ).toBeVisible();
  await expect(word.getByText("the metro / subway", { exact: true })).toBeVisible();
  await word.getByRole("button", { name: "Close" }).click();

  await openProfile(page, displayName);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export my progress" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^paretto-progress-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const exportedProgressPath = await download.path();
  expect(exportedProgressPath).not.toBeNull();

  const changedName = "Changed After Export";
  await page.getByLabel("Display name").fill(changedName);
  await page.getByLabel("Display name").press("Tab");
  await expect(
    page.getByRole("heading", { name: changedName, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Choose a Paretto progress export")
    .setInputFiles(exportedProgressPath!);
  await expect(
    page.getByRole("status").filter({
      hasText: "Progress imported and saved on this device.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: displayName, exact: true }),
  ).toBeVisible();
  await expectCloudSave(page);
});

test("a seeded verified email account claims anonymous progress across browsers and deletes cleanly", async ({
  browser,
  page,
}, testInfo) => {
  const account = localAuthAccount(testInfo);
  const displayName = `${account.name} Progress`;
  await beginAsNewLearner(page, displayName);
  await completeCurrentLesson(page, /Start lesson 1/i);

  await page.goto("/sign-in");
  await expect(
    page.getByText(
      "New email account registration is temporarily unavailable. Existing learners can still sign in.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Create account" }),
  ).toHaveCount(0);

  // Production requires a working verification mail path for public signup.
  // The browser gate therefore creates verified users only in its disposable
  // local D1 fixture and proves that the public endpoint remains closed.
  const applicationOrigin = new URL(page.url()).origin;
  const publicSignup = await page.request.post("/api/auth/sign-up/email", {
    headers: {
      origin: applicationOrigin,
      referer: `${applicationOrigin}/sign-in`,
    },
    data: {
      name: account.name,
      email: `blocked-${account.email}`,
      password: LOCAL_AUTH_PASSWORD,
    },
  });
  expect(publicSignup.status()).toBe(403);
  await expect(publicSignup.json()).resolves.toMatchObject({
    code: "EMAIL_ACCOUNT_CREATION_DISABLED",
  });

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(LOCAL_AUTH_PASSWORD);
  await page
    .getByRole("button", { name: "Sign in and connect progress" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your French is going places." }),
  ).toBeVisible({ timeout: 30_000 });
  await expectCloudSave(page);
  await openProfile(page, displayName);
  await expect(page.getByText(`Signed in as ${account.email}.`)).toBeVisible();
  const sessionCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("session_token"),
  );
  expect(sessionCookies.length).toBeGreaterThan(0);
  expect(sessionCookies.every((cookie) => cookie.secure)).toBe(true);
  await expect(
    page.getByRole("region", { name: "Progress statistics" }).getByText("5", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("button", { name: "Begin the journey" }),
  ).toBeVisible({ timeout: 30_000 });

  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
  });
  const secondPage = await secondContext.newPage();
  try {
    await signInWithSeededAccount(secondPage, account);
    await openProfile(secondPage, displayName);
    await expect(
      secondPage.getByText(`Signed in as ${account.email}.`),
    ).toBeVisible();
    await expect(
      secondPage
        .getByRole("region", { name: "Progress statistics" })
        .getByText("5", { exact: true }),
    ).toBeVisible();

    await secondPage.getByRole("button", { name: "Delete account" }).click();
    const deletion = secondPage.getByRole("alert");
    await expect(
      deletion.getByText("Delete your account and synced learning data?"),
    ).toBeVisible();
    await deletion
      .getByLabel("Current password, if your account uses one")
      .fill(LOCAL_AUTH_PASSWORD);
    await deletion
      .getByRole("button", { name: "Delete account permanently" })
      .click();
    await expect(
      secondPage.getByRole("button", { name: "Begin the journey" }),
    ).toBeVisible({ timeout: 30_000 });

    await secondPage.goto("/sign-in");
    await secondPage.getByLabel("Email").fill(account.email);
    await secondPage.getByLabel("Password").fill(LOCAL_AUTH_PASSWORD);
    await secondPage
      .getByRole("button", { name: "Sign in and connect progress" })
      .click();
    await expect(secondPage.getByRole("alert")).toContainText(
      /Invalid email or password/i,
    );
  } finally {
    await secondContext.close();
  }
});

test("keyboard focus is restored after dialogs and moved after navigation", async ({
  page,
}) => {
  await beginAsNewLearner(page);
  await expectNoSeriousAccessibilityViolations(page);

  const startLesson = page
    .getByRole("button", { name: /Start lesson 1/i })
    .first();
  await startLesson.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(startLesson).toBeFocused();

  await page
    .getByRole("button", { name: "Journey", exact: true })
    .first()
    .click();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "France, word by word." }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Ari\s+Level \d+ traveler/i })
    .click();
  const deleteButton = page.getByRole("button", {
    name: "Delete my learning data",
  });
  await deleteButton.click();
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);
  await cancel.click();
  await expect(deleteButton).toBeFocused();
});

test("offline state makes the local-storage promise explicit", async ({
  context,
  page,
}) => {
  await beginAsNewLearner(page);
  await context.setOffline(true);
  try {
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      /Your lesson is saved on this device|This browser blocked offline storage/,
    );
    await expect(alert).toContainText(
      /queued in this browser and will sync when you reconnect|reconnect before continuing/i,
    );
  } finally {
    await context.setOffline(false);
  }
});

test("Chromium cold-starts into the identity-free offline shell", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The release gate exercises the installed-service-worker cold start in Chromium.",
  );
  const offlineOrigin = await startOfflineShellOrigin();
  const offlineContext = await browser.newContext({
    baseURL: offlineOrigin.origin,
    serviceWorkers: "allow",
  });
  const offlinePage = await offlineContext.newPage();
  try {
    await offlinePage.goto("/");
    await offlinePage.evaluate(() => {
      window.localStorage.setItem(
        "paretto-e2e-identity-marker",
        "Offline Secret Learner",
      );
    });
    await offlinePage.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await offlinePage.reload();
    await expect
      .poll(() =>
        offlinePage.evaluate(() =>
          Boolean(navigator.serviceWorker.controller),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        offlinePage.evaluate(async () => {
          const cache = await caches.open("paretto-static-v6");
          return Boolean(await cache.match("/offline.html"));
        }),
      )
      .toBe(true);

    // Closing the dedicated local origin makes the next top-level navigation a
    // true cold network failure while leaving Chromium and its installed
    // production service worker running.
    await offlineOrigin.stop();
    await offlinePage.goto("/cold-offline-navigation");
    await expect(offlinePage).toHaveTitle("Reconnect to Paretto");
    await expect(
      offlinePage.getByRole("heading", { name: "You’re offline." }),
    ).toBeVisible();
    await expect(
      offlinePage.getByText(
        "This offline page contains no learning or lesson data.",
      ),
    ).toBeVisible();
    await expect(offlinePage.getByText("Offline Secret Learner")).toHaveCount(
      0,
    );
    await expect(offlinePage.locator("script")).toHaveCount(0);
  } finally {
    await offlineContext.close();
    await offlineOrigin.stop();
  }
});

test("account connection and authentication surfaces fail safely", async ({
  page,
}) => {
  await page.route("**/api/account/claim", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "E2E simulated account outage." }),
    }),
  );
  await page.goto("/auth/connected");
  await expect(
    page.getByRole("heading", { name: "Connection needs another try." }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "progress could not be connected",
  );
  await expect(page.getByRole("link", { name: "Return to Paretto" })).toBeVisible();
  await page.unroute("**/api/account/claim");

  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Keep every word with you." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue without an account" }),
  ).toBeVisible();
  const emailField = page.getByLabel("Email");
  await expect(emailField).toBeVisible();
  await expect(
    page.getByText(
      "New email account registration is temporarily unavailable. Existing learners can still sign in.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Create account" }),
  ).toHaveCount(0);

  await page.goto("/reset-password?token=e2e-placeholder");
  await expect(
    page.getByRole("heading", { name: /Choose a new password/i }),
  ).toBeVisible();
  await expect(page.getByLabel(/New password/i)).toBeVisible();
});

test("support security recovery preserves the learner request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.turnstile = {
      render: (_container, options) => {
        queueMicrotask(() => options["error-callback"]());
        return "e2e-turnstile";
      },
      reset: () => undefined,
      remove: () => undefined,
    };
  });
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.abort(),
  );
  await page.goto("/support");
  await expect(
    page.getByRole("heading", {
      name: "Tell us what is getting in the way.",
    }),
  ).toBeVisible();
  await page.getByLabel("Subject").fill("Audio did not start");
  await page
    .getByLabel("Message")
    .fill("The audio button stayed unavailable after I tried again.");
  await expect(page.getByLabel("Subject")).toHaveValue("Audio did not start");
  await expect(page.getByLabel("Message")).toHaveValue(
    "The audio button stayed unavailable after I tried again.",
  );
  const challengeStatus = page.locator(".turnstile-status");
  await expect(challengeStatus).toContainText(
    /security check could not load/i,
  );
  const sendButton = page.getByRole("button", { name: "Send securely" });
  await expect(sendButton).toBeDisabled();
  await page.getByRole("button", { name: "Reload security check" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("Audio did not start");
  await expect(page.getByLabel("Message")).toHaveValue(
    "The audio button stayed unavailable after I tried again.",
  );
  await expect(challengeStatus).toContainText(/security check could not load/i);
});

test("support status failures are announced and focused", async ({ page }) => {
  await page.goto("/support");
  const supportReference = "00000000-0000-4000-8000-000000000001";
  await page.route(`**/api/support/${supportReference}`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: "No support request matches this browser and reference.",
      }),
    }),
  );
  await page.getByLabel("Support reference").fill(supportReference);
  await page.getByRole("button", { name: "Check status" }).click();
  const statusError = page.getByRole("alert");
  await expect(statusError).toContainText("No support request matches");
  await expect(statusError).toBeFocused();
});

test("not-found recovery returns the learner home", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "This stop isn’t on the route." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Paretto" }).click();
  await expect(
    page.getByRole("heading", { name: /Learn French,\s*one region at a time/i }),
  ).toBeVisible();
});

test("critical public pages have no serious automated accessibility violations", async ({
  page,
}) => {
  for (const path of ["/", "/sign-in", "/support", "/privacy"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  }
});

test("the learner and account surfaces fit a current phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginAsNewLearner(page);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).last()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  await page.goto("/sign-in");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});

test("an Android-sized large-text journey respects reduced motion without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.addStyleTag({
    content: "html { font-size: 200% !important; }",
  });

  await expect(
    page.getByRole("heading", { name: /Learn French,\s*one region at a time/i }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: /Begin the journey/i }).click();
  await page.getByLabel("What should we call you?").fill("Léa");
  await page.getByRole("button", { name: /Start with Paris basics/i }).click();

  await expect(
    page.getByRole("heading", { name: "Your French is going places." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).last(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          return false;
        }
        const animated = document.querySelector(".page-enter");
        if (!animated) return false;
        const durations = getComputedStyle(animated).animationDuration
          .split(",")
          .map((value) => {
            const duration = Number.parseFloat(value);
            return value.trim().endsWith("ms") ? duration : duration * 1_000;
          });
        return durations.every((duration) => duration <= 0.1);
      }),
    )
    .toBe(true);
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

function localAuthAccount(testInfo: TestInfo) {
  const account = LOCAL_AUTH_ACCOUNTS[testInfo.project.name];
  if (!account) {
    throw new Error(
      `No disposable local auth fixture for ${testInfo.project.name}.`,
    );
  }
  return account;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sendPlaintextProbe(host: string, port: number): Promise<void> {
  return new Promise((resolveProbe, rejectProbe) => {
    let connected = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    const socket = connect({ host, port });
    socket.setTimeout(3_000);
    socket.once("connect", () => {
      connected = true;
      socket.end(
        `GET /favicon.svg HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", () => {});
    socket.once("close", () => {
      if (connected) finish();
      else finish(new Error("The plaintext probe closed before connecting."));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (
        connected &&
        (error.code === "ECONNRESET" || error.code === "EPIPE")
      ) {
        finish();
        return;
      }
      finish(error);
    });
    socket.once("timeout", () => {
      finish(
        connected
          ? undefined
          : new Error("The plaintext probe could not connect."),
      );
    });
  });
}

async function startOfflineShellOrigin(): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const publicDirectory = resolve(import.meta.dirname, "..", "public");
  const staticPaths = [
    "/offline.html",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/manifest.webmanifest",
    "/service-worker.js",
  ];
  const assets = new Map(
    await Promise.all(
      staticPaths.map(async (pathname) => [
        pathname,
        await readFile(resolve(publicDirectory, pathname.slice(1))),
      ] as const),
    ),
  );
  const server = createServer((request, response) => {
    const pathname = new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).pathname;
    if (pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(
        "<!doctype html><html><head><title>Paretto online bootstrap</title></head>" +
          "<body><h1>Online bootstrap</h1><script>" +
          "navigator.serviceWorker.register('/service-worker.js', {scope: '/'});" +
          "</script></body></html>",
      );
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentType(pathname),
      "cache-control":
        pathname === "/service-worker.js" ? "no-store" : "public, max-age=60",
      ...(pathname === "/service-worker.js"
        ? { "service-worker-allowed": "/" }
        : {}),
    });
    response.end(asset);
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => ready());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The local offline-shell server did not bind a TCP port.");
  }
  let stopped = false;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((done, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else done();
        });
        server.closeAllConnections();
      });
    },
  };
}

function contentType(pathname: string): string {
  switch (extname(pathname)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

declare global {
  interface Window {
    axe: typeof axe;
  }
}
