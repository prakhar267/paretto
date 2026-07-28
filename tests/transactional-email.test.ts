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

  it("never sends mail to a synthetic Paretto account alias", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTransactionalEmail(
        {
          RESEND_API_KEY: "re_test_only",
          AUTH_EMAIL_FROM: "Paretto <accounts@paretto.test>",
        },
        {
          to: "u-private@accounts.paretto.invalid",
          subject: "Must not leave the service",
          text: "Synthetic account aliases are not delivery addresses.",
        },
      ),
    ).rejects.toThrow("recipient is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
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
