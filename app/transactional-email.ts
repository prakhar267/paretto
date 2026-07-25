export type EmailBindings = {
  RESEND_API_KEY?: unknown;
  AUTH_EMAIL_FROM?: unknown;
  SUPPORT_NOTIFICATION_EMAIL?: unknown;
};

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
  idempotencyKey?: string;
};

export function transactionalEmailConfigured(
  bindings: EmailBindings,
): boolean {
  return Boolean(
    nonEmpty(bindings.RESEND_API_KEY) &&
      validSender(nonEmpty(bindings.AUTH_EMAIL_FROM)),
  );
}

export async function sendTransactionalEmail(
  bindings: EmailBindings,
  message: TransactionalEmail,
): Promise<void> {
  const apiKey = nonEmpty(bindings.RESEND_API_KEY);
  const from = nonEmpty(bindings.AUTH_EMAIL_FROM);
  if (!apiKey || !validSender(from)) {
    throw new Error("Transactional email is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(message.idempotencyKey
        ? { "idempotency-key": message.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(validEmail(message.replyTo) ? { reply_to: message.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Transactional email failed with ${response.status}.`);
  }
}

async function emailBindings(): Promise<EmailBindings> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as EmailBindings;
}

export async function loadTransactionalEmailBindings(): Promise<EmailBindings> {
  return emailBindings();
}

export function supportOperatorEmail(
  bindings: EmailBindings,
): string | null {
  const value = nonEmpty(bindings.SUPPORT_NOTIFICATION_EMAIL);
  return validEmail(value) ? value : null;
}

export function validTransactionalRecipient(
  value: unknown,
): value is string {
  return validEmail(value);
}

function validSender(value: string | null): value is string {
  return Boolean(
    value &&
      value.length <= 320 &&
      /<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value),
  );
}

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
