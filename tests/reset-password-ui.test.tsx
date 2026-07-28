import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

const { default: ResetPasswordPage } = await import(
  "../app/reset-password/page"
);

describe("retired email reset route", () => {
  it("routes every legacy reset link to Paretto ID recovery", () => {
    expect(() => ResetPasswordPage()).toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in");
  });
});
