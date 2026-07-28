const PASSWORD_HASH_SCHEME = "pbkdf2-sha256-v1";
const PASSWORD_HASH_ITERATIONS = 600_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_DERIVED_BYTES = 32;
const PASSWORD_MAX_LENGTH = 128;
const encoder = new TextEncoder();

export async function hashParettoPassword(
  password: string,
): Promise<string> {
  if (password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error("Password length is outside the supported range.");
  }
  const salt = crypto.getRandomValues(
    new Uint8Array(PASSWORD_SALT_BYTES),
  );
  const derived = await derivePassword(password, salt);
  return [
    PASSWORD_HASH_SCHEME,
    String(PASSWORD_HASH_ITERATIONS),
    base64Url(salt),
    base64Url(derived),
  ].join("$");
}

export async function verifyParettoPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (password.length < 1 || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  const match = encodedHash.match(
    /^pbkdf2-sha256-v1\$600000\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/,
  );
  if (!match) return false;
  const salt = fromBase64Url(match[1], PASSWORD_SALT_BYTES);
  const expected = fromBase64Url(match[2], PASSWORD_DERIVED_BYTES);
  if (!salt || !expected) return false;
  const actual = await derivePassword(password, salt);
  return constantTimeEqual(actual, expected);
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer,
      iterations: PASSWORD_HASH_ITERATIONS,
    },
    key,
    PASSWORD_DERIVED_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(
  first: Uint8Array,
  second: Uint8Array,
): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(
  value: string,
  expectedBytes: number,
): Uint8Array | null {
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    if (binary.length !== expectedBytes) return null;
    return Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}
