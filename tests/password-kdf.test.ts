import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  hashParettoPassword,
  parettoPasswordVerifierNeedsRehash,
  validParettoPasswordPepperConfiguration,
  verifyParettoPassword,
  verifyParettoPasswordWithStatus,
} from "../app/password-kdf";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const CURRENT_PEPPER =
  "test-current-password-pepper-with-at-least-32-characters";
const RETAINED_PEPPER =
  "test-retained-password-pepper-with-at-least-32-characters";

function pepperConfiguration(
  current = "k2",
  keys: Record<string, string> = {
    k2: CURRENT_PEPPER,
    k1: RETAINED_PEPPER,
  },
): string {
  return JSON.stringify({ current, keys });
}

describe("Paretto password KDF", () => {
  beforeEach(() => {
    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: pepperConfiguration(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a unique peppered PBKDF2-SHA256 verifier and rejects wrong passwords", async () => {
    const password = "correct horse battery staple";
    const first = await hashParettoPassword(password);
    const second = await hashParettoPassword(password);

    expect(first).toMatch(
      /^pbkdf2-sha256-peppered-v3\$100000\$k2\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    expect(second).not.toBe(first);
    expect(first).not.toContain(password);
    await expect(verifyParettoPassword(password, first)).resolves.toBe(true);
    await expect(
      verifyParettoPassword("a different password", first),
    ).resolves.toBe(false);
  });

  it("requires the independent current pepper to verify a database value", async () => {
    const password = "correct horse battery staple";
    const verifier = await hashParettoPassword(password);

    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: pepperConfiguration("k2", {
        k2: "different-test-password-pepper-with-at-least-32-characters",
        k1: RETAINED_PEPPER,
      }),
    });

    await expect(verifyParettoPassword(password, verifier)).resolves.toBe(
      false,
    );
  });

  it("accepts a retained key and reports that the verifier needs rehashing", async () => {
    const password = "correct horse battery staple";
    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: pepperConfiguration("k1", {
        k1: RETAINED_PEPPER,
      }),
    });
    const retainedVerifier = await hashParettoPassword(password);

    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: pepperConfiguration(),
    });
    await expect(
      verifyParettoPasswordWithStatus(password, retainedVerifier),
    ).resolves.toEqual({ valid: true, needsRehash: true });
    await expect(
      parettoPasswordVerifierNeedsRehash(retainedVerifier),
    ).resolves.toBe(true);
    await expect(
      verifyParettoPassword(password, retainedVerifier),
    ).resolves.toBe(true);

    const currentVerifier = await hashParettoPassword(password);
    await expect(
      verifyParettoPasswordWithStatus(password, currentVerifier),
    ).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(
      parettoPasswordVerifierNeedsRehash(currentVerifier),
    ).resolves.toBe(false);

    setCloudflareEnv({
      PARETTO_PASSWORD_PEPPERS: pepperConfiguration("k2", {
        k2: CURRENT_PEPPER,
      }),
    });
    await expect(
      verifyParettoPasswordWithStatus(password, retainedVerifier),
    ).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it("validates the bounded compact keyring contract", () => {
    expect(
      validParettoPasswordPepperConfiguration(pepperConfiguration()),
    ).toBe(true);
    expect(
      validParettoPasswordPepperConfiguration(
        pepperConfiguration("release_2026-07", {
          "release_2026-07": CURRENT_PEPPER,
        }),
      ),
    ).toBe(true);

    const invalidValues: unknown[] = [
      undefined,
      null,
      {},
      "",
      "not-json",
      " " + pepperConfiguration(),
      JSON.stringify({ current: "k2" }),
      JSON.stringify({
        current: "missing",
        keys: { k2: CURRENT_PEPPER },
      }),
      JSON.stringify({
        current: "invalid key id",
        keys: { "invalid key id": CURRENT_PEPPER },
      }),
      JSON.stringify({ current: "k2", keys: { k2: "too-short" } }),
      JSON.stringify({
        current: "k2",
        keys: { k2: ` ${CURRENT_PEPPER}` },
      }),
      JSON.stringify({
        current: "k2",
        keys: {
          k2: CURRENT_PEPPER,
          k1: CURRENT_PEPPER,
        },
      }),
      JSON.stringify({
        current: "k4",
        keys: {
          k4: `${CURRENT_PEPPER}-4`,
          k3: `${CURRENT_PEPPER}-3`,
          k2: `${CURRENT_PEPPER}-2`,
          k1: `${CURRENT_PEPPER}-1`,
        },
      }),
      JSON.stringify({
        current: "k2",
        keys: { k2: CURRENT_PEPPER },
        unexpected: true,
      }),
      "x".repeat(257),
    ];
    for (const value of invalidValues) {
      expect(validParettoPasswordPepperConfiguration(value)).toBe(false);
    }
  });

  it("fails closed when the production keyring is missing or invalid", async () => {
    const password = "correct horse battery staple";
    const verifier = await hashParettoPassword(password);
    vi.stubEnv("NODE_ENV", "production");

    setCloudflareEnv({});
    await expect(hashParettoPassword(password)).rejects.toThrow(
      "PARETTO_PASSWORD_PEPPERS is not configured",
    );
    await expect(
      verifyParettoPassword(password, verifier),
    ).rejects.toThrow("PARETTO_PASSWORD_PEPPERS is not configured");

    setCloudflareEnv({ PARETTO_PASSWORD_PEPPERS: "{}" });
    await expect(hashParettoPassword(password)).rejects.toThrow(
      "PARETTO_PASSWORD_PEPPERS is not configured",
    );
    await expect(
      verifyParettoPassword(password, verifier),
    ).rejects.toThrow("PARETTO_PASSWORD_PEPPERS is not configured");
  });

  it("accepts the maximum password length without truncation", async () => {
    const password = "é".repeat(128);
    const verifier = await hashParettoPassword(password);

    await expect(verifyParettoPassword(password, verifier)).resolves.toBe(
      true,
    );
    await expect(
      verifyParettoPassword(`${password.slice(0, -1)}e`, verifier),
    ).resolves.toBe(false);
  });

  it("rejects a non-canonical Base64URL verifier representation", async () => {
    const password = "correct horse battery staple";
    const verifier = await hashParettoPassword(password);
    const [scheme, iterations, keyId, salt, digest] = verifier.split("$");
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalSaltIndex = alphabet.indexOf(salt.at(-1)!);
    const nonCanonicalSalt =
      salt.slice(0, -1) + alphabet[finalSaltIndex ^ 1];

    await expect(
      verifyParettoPassword(
        password,
        [
          scheme,
          iterations,
          keyId,
          nonCanonicalSalt,
          digest,
        ].join("$"),
      ),
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
      verifyParettoPassword(
        "password",
        "pbkdf2-sha256-v1$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyParettoPassword(
        "password",
        "pbkdf2-sha256-peppered-v2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).resolves.toBe(false);
    await expect(
      verifyParettoPassword(
        "password",
        "pbkdf2-sha256-peppered-v3$99999$k2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).resolves.toBe(false);
    await expect(hashParettoPassword("")).rejects.toThrow(
      "Password length is outside the supported range.",
    );
    await expect(hashParettoPassword("x".repeat(129))).rejects.toThrow(
      "Password length is outside the supported range.",
    );
    await expect(
      verifyParettoPassword("x".repeat(129), "not-a-verifier"),
    ).resolves.toBe(false);
  });
});
