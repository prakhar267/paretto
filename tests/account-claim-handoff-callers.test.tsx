// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  socialSignIn: vi.fn(),
  transition: vi.fn(),
}));

vi.mock("../app/auth-client", () => ({
  authClient: {
    signIn: {
      social: mocks.socialSignIn,
    },
  },
}));

vi.mock("../app/TurnstileWidget", () => ({
  default: ({
    onTokenChange,
  }: {
    onTokenChange: (token: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onTokenChange("verified-turnstile-token")}
    >
      Complete security check
    </button>
  ),
}));

vi.mock("../app/progress-cache", () => ({
  transitionClaimedProgressCache: mocks.transition,
}));

const { default: AuthForm } = await import("../app/sign-in/AuthForm");
const { default: ConnectedAccount } = await import(
  "../app/auth/connected/ConnectedAccount"
);

describe("account claim cache handoff callers", () => {
  beforeEach(() => {
    mocks.socialSignIn.mockReset();
    mocks.transition.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps Paretto ID sign-in visible when registration and recovery are disabled", () => {
    render(
      <AuthForm
        googleEnabled={false}
        appleEnabled={false}
        accountCreationEnabled={false}
        recoveryEnabled={false}
        turnstileSiteKey="test-site-key"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Sign in and connect progress" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use a recovery code" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Paretto ID" }),
    ).toBeVisible();
  });

  it("awaits the Paretto ID sign-in handoff and reports a blocked local transition", async () => {
    const user = userEvent.setup();
    const claimPayload = {
      state: { version: 1 },
      revision: 3,
      cacheTransition: {
        accountStorageKey: "account-cache",
        anonymousStorageKey: "anonymous-cache",
      },
    };
    mocks.transition.mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/account/sign-in"
          ? Response.json({ signedIn: true, username: "camille" })
          : Response.json(claimPayload),
      ),
    );

    render(
      <AuthForm
        googleEnabled={false}
        appleEnabled={false}
        accountCreationEnabled={true}
        recoveryEnabled={true}
        turnstileSiteKey="test-site-key"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(
      screen.getByRole("textbox", { name: "Paretto ID" }),
      "Camille",
    );
    await user.type(
      screen.getByLabelText("Password"),
      "long-test-password",
    );
    await user.click(
      screen.getByRole("button", { name: "Complete security check" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Sign in and connect progress",
      }),
    );

    expect(
      await screen.findByText(/could not safely hand off its local progress/i),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/account/sign-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "camille",
          password: "long-test-password",
          turnstileToken: "verified-turnstile-token",
        }),
      }),
    );
    expect(mocks.transition).toHaveBeenCalledWith(claimPayload);
  });

  it("awaits the OAuth callback handoff before leaving the connected-account page", async () => {
    const claimPayload = {
      state: { version: 1 },
      revision: 4,
      cacheTransition: {
        accountStorageKey: "oauth-account-cache",
        anonymousStorageKey: "oauth-anonymous-cache",
      },
    };
    let releaseTransition: (value: boolean) => void = () => undefined;
    mocks.transition.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseTransition = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(claimPayload)),
    );

    render(<ConnectedAccount />);
    expect(
      screen.getByRole("heading", { name: /connecting your progress/i }),
    ).toBeVisible();
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("heading", { name: /connecting your progress/i }),
    ).toBeVisible();

    releaseTransition(false);

    expect(
      await screen.findByRole("heading", {
        name: /connection needs another try/i,
      }),
    ).toBeVisible();
    expect(mocks.transition).toHaveBeenCalledWith(claimPayload);
  });

  it("recovers when the social provider launch rejects before navigation", async () => {
    const user = userEvent.setup();
    mocks.socialSignIn.mockRejectedValue(new Error("network unavailable"));

    render(
      <AuthForm
        googleEnabled
        appleEnabled={false}
        accountCreationEnabled
        recoveryEnabled
        turnstileSiteKey="test-site-key"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(/check your connection and try again/i);
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  });

  it("announces a sanitized OAuth callback failure", () => {
    render(
      <AuthForm
        googleEnabled
        appleEnabled={false}
        accountCreationEnabled
        recoveryEnabled
        turnstileSiteKey="test-site-key"
        initialError="Social sign-in could not be completed. Please try again."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Social sign-in could not be completed. Please try again.",
    );
  });
});
