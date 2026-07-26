// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialState, type LearningState } from "../app/learning-engine";

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  deleteUser: vi.fn(),
  session: {
    data: {
      user: {
        id: "learner-1",
        email: "camille@example.test",
        name: "Camille",
      },
    },
    isPending: false,
  },
}));

vi.mock("../app/auth-client", () => ({
  authClient: {
    useSession: () => authMocks.session,
    signOut: authMocks.signOut,
    deleteUser: authMocks.deleteUser,
  },
}));

const { default: ParettoApp } = await import("../app/ParettoApp");

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("learner account lifecycle errors", () => {
  let serverState: LearningState;
  let browserProfileStatus: number;
  let claimNetworkFailure: boolean;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    serverState = {
      ...createInitialState(new Date("2026-07-20T08:00:00.000Z")),
      onboarded: true,
      displayName: "Camille",
      xp: 80,
    };
    browserProfileStatus = 200;
    claimNetworkFailure = false;
    authMocks.signOut.mockReset();
    authMocks.deleteUser.mockReset();
    fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/account/claim" && claimNetworkFailure) {
          throw new TypeError("network unavailable");
        }
        if (url === "/api/account/browser-profile") {
          return jsonResponse({}, browserProfileStatus);
        }
        if ((init?.method ?? "GET") === "PUT") {
          const request = JSON.parse(String(init?.body)) as {
            state: LearningState;
          };
          serverState = request.state;
        }
        return jsonResponse({
          state: serverState,
          revision: 1,
          generation: 0,
          savedAt: null,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the profile and error visible when server sign-out fails", async () => {
    const user = userEvent.setup();
    authMocks.signOut.mockResolvedValue({
      data: null,
      error: { message: "Authentication service unavailable." },
    });

    render(<ParettoApp storageKey="sign-out-error-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByText("Authentication service unavailable."),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Camille" }),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.some(
        ([input]) => String(input) === "/api/account/browser-profile",
      ),
    ).toBe(false);
  });

  it("hides the previous learner when sign-out succeeds but browser-profile rotation fails", async () => {
    const user = userEvent.setup();
    browserProfileStatus = 503;
    authMocks.signOut.mockResolvedValue({ data: {}, error: null });

    render(<ParettoApp storageKey="sign-out-rotation-error-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "You are signed out." }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /previous learner’s data remains hidden; retry before another learner uses this browser/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry secure profile" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Camille" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  it("hides deleted-account data when browser-profile rotation fails", async () => {
    const user = userEvent.setup();
    browserProfileStatus = 503;
    authMocks.deleteUser.mockResolvedValue({ data: {}, error: null });

    render(<ParettoApp storageKey="account-delete-error-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(
      screen.getByRole("button", { name: "Delete account permanently" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your account was deleted." }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /previous learner’s data remains hidden; retry before another learner uses this browser/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry secure profile" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Camille" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("80")).not.toBeInTheDocument();
  });

  it("reports a reconnect network failure instead of leaking a rejected promise", async () => {
    const user = userEvent.setup();
    claimNetworkFailure = true;

    render(<ParettoApp storageKey="account-reconnect-error-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));
    await user.click(
      screen.getByRole("button", { name: "Reconnect progress" }),
    );

    expect(
      await screen.findByText(
        "Progress could not be connected. Check your connection and retry.",
      ),
    ).toBeVisible();
  });

  it("explains how a social-only learner can recover from an expired deletion session", async () => {
    const user = userEvent.setup();
    authMocks.deleteUser.mockResolvedValue({
      data: null,
      error: {
        code: "SESSION_EXPIRED",
        message: "raw provider session error",
      },
    });

    render(<ParettoApp storageKey="account-delete-expired-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(
      screen.getByRole("button", { name: "Delete account permanently" }),
    );

    expect(
      await screen.findByText(
        "For security, sign out and sign in again before deleting this social-only account.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("raw provider session error")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete account permanently" }),
    ).toBeEnabled();
  });
});
