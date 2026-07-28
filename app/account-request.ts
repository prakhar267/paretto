import {
  normalizeParettoId,
  parettoIdValidationError,
} from "@/app/account-id";
import { isRecord } from "@/app/api/_lib/api-utils";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;

export type AccountRegistrationInput = {
  username: string;
  password: string;
  turnstileToken: string;
};

export type AccountRecoveryInput = {
  username: string;
  recoveryCode: string;
  password: string;
  turnstileToken: string;
};

export type AccountSignInInput = {
  username: string;
  password: string;
  turnstileToken: string;
};

export type RecoveryCodeRotationInput = {
  password: string;
  turnstileToken: string;
};

export type AccountDeletionInput = {
  password: string;
};

export function validateAccountRegistration(
  value: unknown,
):
  | { ok: true; value: AccountRegistrationInput }
  | { ok: false; error: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "username",
      "password",
      "turnstileToken",
    ])
  ) {
    return invalidRequest();
  }
  const username = normalizeUsername(value.username);
  if (!username.ok) return username;
  const passwordError = validatePassword(value.password);
  if (passwordError) return { ok: false, error: passwordError };
  const token = validateTurnstileToken(value.turnstileToken);
  if (!token) return invalidSecurityCheck();
  return {
    ok: true,
    value: {
      username: username.value,
      password: value.password as string,
      turnstileToken: token,
    },
  };
}

export function validateAccountRecovery(
  value: unknown,
):
  | { ok: true; value: AccountRecoveryInput }
  | { ok: false; error: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "username",
      "recoveryCode",
      "password",
      "turnstileToken",
    ])
  ) {
    return invalidRequest();
  }
  const username = normalizeUsername(value.username);
  if (!username.ok) return username;
  if (
    typeof value.recoveryCode !== "string" ||
    value.recoveryCode.length < 1 ||
    value.recoveryCode.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(value.recoveryCode)
  ) {
    return { ok: false, error: "Enter one of your unused recovery codes." };
  }
  const passwordError = validatePassword(value.password);
  if (passwordError) return { ok: false, error: passwordError };
  const token = validateTurnstileToken(value.turnstileToken);
  if (!token) return invalidSecurityCheck();
  return {
    ok: true,
    value: {
      username: username.value,
      recoveryCode: value.recoveryCode,
      password: value.password as string,
      turnstileToken: token,
    },
  };
}

export function validateAccountSignIn(
  value: unknown,
):
  | { ok: true; value: AccountSignInInput }
  | { ok: false; error: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["username", "password", "turnstileToken"])
  ) {
    return invalidRequest();
  }
  const username = normalizeUsername(value.username);
  if (!username.ok) {
    return {
      ok: false,
      error: "The Paretto ID or password is incorrect.",
    };
  }
  if (
    typeof value.password !== "string" ||
    value.password.length < 1 ||
    value.password.length > MAX_PASSWORD_LENGTH
  ) {
    return {
      ok: false,
      error: "The Paretto ID or password is incorrect.",
    };
  }
  const token = validateTurnstileToken(value.turnstileToken);
  if (!token) return invalidSecurityCheck();
  return {
    ok: true,
    value: {
      username: username.value,
      password: value.password,
      turnstileToken: token,
    },
  };
}

export function validateRecoveryCodeRotation(
  value: unknown,
):
  | { ok: true; value: RecoveryCodeRotationInput }
  | { ok: false; error: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["password", "turnstileToken"])
  ) {
    return invalidRequest();
  }
  if (
    typeof value.password !== "string" ||
    value.password.length < 1 ||
    value.password.length > MAX_PASSWORD_LENGTH
  ) {
    return { ok: false, error: "Enter your current password." };
  }
  const token = validateTurnstileToken(value.turnstileToken);
  if (!token) return invalidSecurityCheck();
  return {
    ok: true,
    value: {
      password: value.password,
      turnstileToken: token,
    },
  };
}

export function validateAccountDeletion(
  value: unknown,
):
  | { ok: true; value: AccountDeletionInput }
  | { ok: false; error: string } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["password"]) ||
    typeof value.password !== "string" ||
    value.password.length > MAX_PASSWORD_LENGTH
  ) {
    return invalidRequest();
  }
  return {
    ok: true,
    value: {
      password: value.password,
    },
  };
}

function normalizeUsername(
  value: unknown,
):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "Enter your Paretto ID." };
  }
  const error = parettoIdValidationError(value);
  return error
    ? { ok: false, error }
    : { ok: true, value: normalizeParettoId(value) };
}

function validatePassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Use no more than ${MAX_PASSWORD_LENGTH} characters for your password.`;
  }
  return null;
}

function validateTurnstileToken(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_TURNSTILE_TOKEN_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidRequest(): { ok: false; error: string } {
  return { ok: false, error: "The account request is invalid." };
}

function invalidSecurityCheck(): { ok: false; error: string } {
  return {
    ok: false,
    error: "Complete the security check and try again.",
  };
}
