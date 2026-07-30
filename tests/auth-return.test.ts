import { describe, expect, it } from "vitest";

import {
  authDestination,
  DEFAULT_AUTH_RETURN,
  PROFILE_AUTH_RETURN,
  safeAuthReturn,
} from "../app/auth-return";

describe("authentication return destinations", () => {
  it("allows the supported profile handoff", () => {
    expect(safeAuthReturn(PROFILE_AUTH_RETURN)).toBe(PROFILE_AUTH_RETURN);
    expect(authDestination("/sign-in", PROFILE_AUTH_RETURN)).toBe(
      "/sign-in?returnTo=%2F%3Fscreen%3Dprofile",
    );
  });

  it("rejects external, protocol-relative, and unknown return destinations", () => {
    for (const candidate of [
      "https://attacker.example",
      "//attacker.example",
      "/admin",
      "/?screen=journey",
      ["https://attacker.example"],
      undefined,
    ]) {
      expect(safeAuthReturn(candidate)).toBe(DEFAULT_AUTH_RETURN);
    }
  });
});
