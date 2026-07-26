import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendTransactionalEmail,
  supportOperatorEmail,
  transactionalEmailConfigured,
} from "../app/transactional-email";

describe("transactional email transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends through the configured provider with a stable idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const bindings = {
      RESEND_API_KEY: "re_test_only",
      AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
    };

    await sendTransactionalEmail(bindings, {
      to: "care@paretto.test",
      replyTo: "learner@example.test",
      subject: "Support",
      text: "Body-free notification metadata.",
      idempotencyKey: "support-notification:job-1",
    });

    expect(transactionalEmailConfigured(bindings)).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "support-notification:job-1",
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ["care@paretto.test"],
      reply_to: "learner@example.test",
    });
  });

  it("rejects unavailable delivery instead of silently discarding it", async () => {
    await expect(
      sendTransactionalEmail({}, {
        to: "care@paretto.test",
        subject: "Support",
        text: "Notification metadata.",
      }),
    ).rejects.toThrow("not configured");
  });

  it("accepts only a valid operator mailbox", () => {
    expect(
      supportOperatorEmail({
        SUPPORT_NOTIFICATION_EMAIL: " care@paretto.test ",
      }),
    ).toBe("care@paretto.test");
    expect(
      supportOperatorEmail({ SUPPORT_NOTIFICATION_EMAIL: "not-an-email" }),
    ).toBeNull();
  });
});
