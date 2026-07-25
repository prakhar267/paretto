// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emailSignIn: vi.fn(),
  emailSignUp: vi.fn(),
  socialSignIn: vi.fn(),
  passwordReset: vi.fn(),
  transition: vi.fn(),
}));

vi.mock("../app/auth-client", () => ({
  authClient: {
    signIn: {
      email: mocks.emailSignIn,
      social: mocks.socialSignIn,
    },
    signUp: {
      email: mocks.emailSignUp,
    },
    requestPasswordReset: mocks.passwordReset,
  },
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
    mocks.emailSignIn.mockReset();
    mocks.emailSignUp.mockReset();
    mocks.socialSignIn.mockReset();
    mocks.passwordReset.mockReset();
    mocks.transition.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps existing-account sign-in visible while email registration and recovery are disabled", () => {
    render(
      <AuthForm
        googleEnabled={false}
        appleEnabled={false}
        accountCreationEnabled={false}
        passwordResetEnabled={false}
        emailVerificationEnabled={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Sign in and connect progress" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Forgot password?" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/new email account registration is temporarily unavailable/i),
    ).toBeVisible();
  });

  it("awaits the email sign-in handoff and reports a blocked local transition", async () => {
    const user = userEvent.setup();
    const claimPayload = {
      state: { version: 1 },
      revision: 3,
      cacheTransition: {
        accountStorageKey: "account-cache",
        anonymousStorageKey: "anonymous-cache",
      },
    };
    mocks.emailSignIn.mockResolvedValue({ data: {}, error: null });
    mocks.transition.mockResolvedValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(claimPayload)),
    );

    render(
      <AuthForm
        googleEnabled={false}
        appleEnabled={false}
        accountCreationEnabled={true}
        passwordResetEnabled={false}
        emailVerificationEnabled={false}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "a@example.test",
    );
    await user.type(
      screen.getByLabelText("Password"),
      "long-test-password",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Sign in and connect progress",
      }),
    );

    expect(
      await screen.findByText(/could not safely hand off its local progress/i),
    ).toBeVisible();
    expect(mocks.emailSignIn).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "long-test-password",
      callbackURL: "/auth/connected",
    });
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
        passwordResetEnabled={false}
        emailVerificationEnabled={false}
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
        passwordResetEnabled={false}
        emailVerificationEnabled={false}
        initialError="Social sign-in could not be completed. Please try again."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Social sign-in could not be completed. Please try again.",
    );
  });
});
