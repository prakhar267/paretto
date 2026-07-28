export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_GROUPS = 6;
export const RECOVERY_CODE_GROUP_LENGTH = 4;

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_DOMAIN = "paretto-account-recovery:v1";
const INTERNAL_EMAIL_DOMAIN = "accounts.paretto.invalid";
const encoder = new TextEncoder();

export type RecoveryCodeSet = {
  plainText: string[];
  hashes: string[];
};

export function normalizeRecoveryCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  const expectedLength = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH;
  if (
    compact.length !== expectedLength ||
    !new RegExp(`^[${RECOVERY_CODE_ALPHABET}]+$`).test(compact)
  ) {
    return null;
  }
  return Array.from(
    { length: RECOVERY_CODE_GROUPS },
    (_, index) =>
      compact.slice(
        index * RECOVERY_CODE_GROUP_LENGTH,
        (index + 1) * RECOVERY_CODE_GROUP_LENGTH,
      ),
  ).join("-");
}

export async function generateRecoveryCodeSet(
  userId: string,
): Promise<RecoveryCodeSet> {
  const plainText = Array.from(
    { length: RECOVERY_CODE_COUNT },
    () => generateRecoveryCode(),
  );
  return {
    plainText,
    hashes: await Promise.all(
      plainText.map((code) =>
        recoveryCodeHash(userId, code),
      ),
    ),
  };
}

export async function hashSubmittedRecoveryCode(
  userId: string,
  code: string,
): Promise<string | null> {
  const normalizedCode = normalizeRecoveryCode(code);
  if (!normalizedCode) return null;
  return recoveryCodeHash(userId, normalizedCode);
}

export function internalAccountEmail(): string {
  return `u-${base64Url(crypto.getRandomValues(new Uint8Array(24)))}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function insertRecoveryCodeStatements(
  database: D1Database,
  userId: string,
  hashes: readonly string[],
  generationId: string,
  createdAt = Date.now(),
): D1PreparedStatement[] {
  return hashes.map((hash) =>
    database
      .prepare(
        `INSERT INTO learner_recovery_codes (
           code_hash, user_id, generation_id, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(hash, userId, generationId, createdAt),
  );
}

function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(
    new Uint8Array(RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH),
  );
  const compact = Array.from(
    bytes,
    (byte) => RECOVERY_CODE_ALPHABET[byte & 31],
  ).join("");
  return Array.from(
    { length: RECOVERY_CODE_GROUPS },
    (_, index) =>
      compact.slice(
        index * RECOVERY_CODE_GROUP_LENGTH,
        (index + 1) * RECOVERY_CODE_GROUP_LENGTH,
      ),
  ).join("-");
}

async function recoveryCodeHash(
  userId: string,
  code: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${RECOVERY_CODE_DOMAIN}\u0000${userId}\u0000${code}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
