// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "../app/error";
import GlobalError from "../app/global-error";
import SupportForm from "../app/support/SupportForm";

type ChallengeOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
};

describe("learner support recovery", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("cloudflare-turnstile-script")?.remove();
    delete window.turnstile;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reloads a failed Turnstile script, restarts an expired challenge, and preserves the request", async () => {
    const user = userEvent.setup();
    const challengeOptions: ChallengeOptions[] = [];
    const remove = vi.fn();
    const reset = vi.fn();
    const renderChallenge = vi.fn(
      (_container: HTMLElement, options: ChallengeOptions) => {
        challengeOptions.push(options);
        return `widget-${challengeOptions.length}`;
      },
    );

    render(<SupportForm turnstileSiteKey="public-site-key" />);
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Audio issue");
    await user.type(
      screen.getByRole("textbox", { name: "Message" }),
      "The pronunciation button did not play.",
    );

    const failedScript = document.getElementById(
      "cloudflare-turnstile-script",
    );
    expect(failedScript).toBeInstanceOf(HTMLScriptElement);
    act(() => {
      failedScript?.dispatchEvent(new Event("error"));
    });

    const reload = await screen.findByRole("button", {
      name: "Reload security check",
    });
    await user.click(reload);

    await waitFor(() => {
      expect(
        document.getElementById("cloudflare-turnstile-script"),
      ).not.toBe(failedScript);
    });
    window.turnstile = {
      render: renderChallenge,
      remove,
      reset,
    };
    const replacementScript = document.getElementById(
      "cloudflare-turnstile-script",
    );
    act(() => {
      replacementScript?.dispatchEvent(new Event("load"));
    });

    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(1));
    expect(challengeOptions[0]).toMatchObject({
      sitekey: "public-site-key",
      action: "support_submit",
    });
    act(() => {
      challengeOptions[0]?.callback("verified-token");
    });
    expect(
      screen.getByRole("button", { name: "Send securely" }),
    ).toBeEnabled();

    act(() => {
      challengeOptions[0]?.["expired-callback"]();
    });
    expect(
      screen.getByRole("button", { name: "Send securely" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Restart security check" }),
    );

    await waitFor(() => expect(renderChallenge).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledWith("widget-1");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      "Audio issue",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
      "The pronunciation button did not play.",
    );
  });

  it("shows the server error in context and safely resets the challenge", async () => {
    const user = userEvent.setup();
    let options: ChallengeOptions | null = null;
    const reset = vi.fn();
    window.turnstile = {
      render: vi.fn(
        (_container: HTMLElement, challengeOptions: ChallengeOptions) => {
          options = challengeOptions;
          return "widget-1";
        },
      ),
      remove: vi.fn(),
      reset,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error:
              "The security check expired or could not be verified. Please try again.",
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    render(<SupportForm turnstileSiteKey="public-site-key" />);
    await waitFor(() => expect(options).not.toBeNull());
    act(() => {
      options?.callback("verified-token");
    });
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Sync issue");
    await user.type(
      screen.getByRole("textbox", { name: "Message" }),
      "My latest lesson is not visible yet.",
    );
    await user.click(screen.getByRole("button", { name: "Send securely" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "The security check expired or could not be verified. Please try again.",
    );
    expect(reset).toHaveBeenCalledWith("widget-1");
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
      "Sync issue",
    );
  });

  it("focuses the receipt so successful submission is announced", async () => {
    const user = userEvent.setup();
    let options: ChallengeOptions | null = null;
    window.turnstile = {
      render: vi.fn(
        (_container: HTMLElement, challengeOptions: ChallengeOptions) => {
          options = challengeOptions;
          return "widget-1";
        },
      ),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ request: { id: "request-reference-123" } }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    render(<SupportForm turnstileSiteKey="public-site-key" />);
    await waitFor(() => expect(options).not.toBeNull());
    act(() => {
      options?.callback("verified-token");
    });
    await user.type(screen.getByRole("textbox", { name: "Subject" }), "Audio issue");
    await user.type(
      screen.getByRole("textbox", { name: "Message" }),
      "The pronunciation button did not play.",
    );
    await user.click(screen.getByRole("button", { name: "Send securely" }));

    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveFocus();
    expect(receipt).toHaveTextContent("request-reference-123");
  });

  it("lets the owning learner track a support request by its receipt", async () => {
    const user = userEvent.setup();
    const reference = "b89166f0-19c8-4dc6-9878-a5174623526c";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            request: {
              id: reference,
              subject: "Audio issue",
              status: "in_progress",
              createdAt: "2026-07-25T00:00:00.000Z",
              updatedAt: "2026-07-25T01:00:00.000Z",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    render(<SupportForm />);
    await user.type(
      screen.getByRole("textbox", { name: "Support reference" }),
      reference,
    );
    await user.click(screen.getByRole("button", { name: "Check status" }));

    const result = await screen.findByRole("status");
    expect(result).toHaveFocus();
    expect(result).toHaveTextContent("In progress");
    expect(result).toHaveTextContent("Audio issue");
    expect(fetch).toHaveBeenCalledWith(`/api/support/${reference}`, {
      headers: { accept: "application/json" },
    });
  });

  it("offers accessible Support links from both route-level recovery surfaces", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const routeError = Object.assign(new Error("Route failed"), {
      digest: "route-reference",
    });

    render(<ErrorPage error={routeError} reset={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "Contact Support" }),
    ).toHaveAttribute("href", "/support");
    expect(screen.getByText("Reference: route-reference")).toBeInTheDocument();
    await expectNoAutomatedA11yViolations(document.body);

    const globalMarkup = renderToStaticMarkup(
      <GlobalError reset={vi.fn()} />,
    );
    expect(globalMarkup).toContain('href="/support"');
    expect(globalMarkup).toContain("Contact Support");
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Warning"),
    );
  });
});

async function expectNoAutomatedA11yViolations(root: Element) {
  const results = await axe.run(root, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);
}
