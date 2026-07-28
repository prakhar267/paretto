import { describe, expect, it } from "vitest";
import {
  hashParettoPassword,
  verifyParettoPassword,
} from "../app/password-kdf";

describe("Paretto password KDF", () => {
  it("uses a unique PBKDF2-SHA256 verifier and rejects wrong passwords", async () => {
    const password = "correct horse battery staple";
    const first = await hashParettoPassword(password);
    const second = await hashParettoPassword(password);

    expect(first).toMatch(
      /^pbkdf2-sha256-v1\$600000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    expect(second).not.toBe(first);
    expect(first).not.toContain(password);
    await expect(verifyParettoPassword(password, first)).resolves.toBe(
      true,
    );
    await expect(
      verifyParettoPassword("a different password", first),
    ).resolves.toBe(false);
  });

  it("fails closed for malformed, legacy, and oversized inputs", async () => {
    await expect(
      verifyParettoPassword("password", "not-a-verifier"),
    ).resolves.toBe(false);
    await expect(
      verifyParettoPassword(
        "password",
        "0123456789abcdef0123456789abcdef:legacy-scrypt",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyParettoPassword("x".repeat(129), "not-a-verifier"),
    ).resolves.toBe(false);
  });
});
