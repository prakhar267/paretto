import { apiJson } from "@/app/api/_lib/api-utils";
import { rotateLearnerSessionCookie } from "@/app/web-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return apiJson(
    { rotated: true },
    200,
    { "set-cookie": rotateLearnerSessionCookie(request) },
  );
}
