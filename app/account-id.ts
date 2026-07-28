export const PARETTO_ID_MIN_LENGTH = 3;
export const PARETTO_ID_MAX_LENGTH = 24;

const PARETTO_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const RESERVED_PARETTO_IDS = new Set([
  "admin",
  "api",
  "help",
  "moderator",
  "null",
  "paretto",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "undefined",
  "www",
]);

export function normalizeParettoId(value: string): string {
  return value.trim().toLowerCase();
}

export function parettoIdValidationError(value: string): string | null {
  const normalized = normalizeParettoId(value);
  if (normalized.length < PARETTO_ID_MIN_LENGTH) {
    return `Use at least ${PARETTO_ID_MIN_LENGTH} characters for your Paretto ID.`;
  }
  if (normalized.length > PARETTO_ID_MAX_LENGTH) {
    return `Use no more than ${PARETTO_ID_MAX_LENGTH} characters for your Paretto ID.`;
  }
  if (!PARETTO_ID_PATTERN.test(normalized)) {
    return "Use letters, numbers, periods, hyphens, or underscores, beginning and ending with a letter or number.";
  }
  if (
    normalized.includes("..") ||
    normalized.includes("--") ||
    normalized.includes("__")
  ) {
    return "Do not repeat periods, hyphens, or underscores in your Paretto ID.";
  }
  if (RESERVED_PARETTO_IDS.has(normalized)) {
    return "That Paretto ID is reserved. Choose another.";
  }
  return null;
}

export function isValidParettoId(value: string): boolean {
  return parettoIdValidationError(value) === null;
}
