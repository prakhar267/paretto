import {
  getLearnerAuth,
  learnerAuthReadiness,
} from "@/app/learner-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    if (
      request.method === "POST" &&
      new URL(request.url).pathname.replace(/\/+$/, "") ===
        "/api/auth/sign-up/email"
    ) {
      const readiness = await learnerAuthReadiness();
      if (!readiness.emailAccountCreation) {
        return Response.json(
          {
            code: "EMAIL_ACCOUNT_CREATION_DISABLED",
            error:
              "New email account registration is temporarily unavailable.",
          },
          {
            status: 403,
            headers: {
              "cache-control": "private, no-store, max-age=0",
              "x-content-type-options": "nosniff",
            },
          },
        );
      }
    }
    return (await getLearnerAuth(request)).handler(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "learner_auth_unavailable",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return Response.json(
      { error: "Learner authentication is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}
