// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.search,
}));

vi.mock("../app/auth-client", () => ({
  authClient: {
    resetPassword: mocks.resetPassword,
  },
}));

const { default: ResetPasswordForm } = await import(
  "../app/reset-password/ResetPasswordForm"
);

describe("password reset recovery UI", () => {
  beforeEach(() => {
    mocks.resetPassword.mockReset();
    mocks.search = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reports an invalid callback token without echoing provider input", () => {
    mocks.search = new URLSearchParams({
      error: "<untrusted-provider-message>",
    });

    render(<ResetPasswordForm />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This reset link is invalid or expired.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "untrusted-provider-message",
    );
  });

  it("recovers from a thrown reset request and re-enables submission", async () => {
    const user = userEvent.setup();
    mocks.search = new URLSearchParams({ token: "reset-token" });
    mocks.resetPassword.mockRejectedValue(new Error("network unavailable"));

    render(<ResetPasswordForm />);
    await user.type(
      screen.getByLabelText(/New password/),
      "new-long-password",
    );
    await user.click(
      screen.getByRole("button", { name: "Update password" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /check your connection and try again/i,
    );
    expect(
      screen.getByRole("button", { name: "Update password" }),
    ).toBeEnabled();
  });
});
