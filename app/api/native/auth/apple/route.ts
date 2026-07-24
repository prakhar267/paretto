import {
  apiError,
  apiJson,
  isRecord,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import {
  exchangeAppleIdentity,
  nativeApiEnabled,
} from "@/app/api/native/_lib/native-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await nativeApiEnabled())) {
    return apiError(503, "Native sign-in is not enabled.");
  }
  const body = await readJsonBody(request, 24 * 1024);
  if (!body.ok) return body.response;
  if (
    !isRecord(body.value) ||
    Object.keys(body.value).some(
      (key) =>
        !["identityToken", "authorizationCode", "rawNonce", "displayName"].includes(
          key,
        ),
    ) ||
    typeof body.value.identityToken !== "string" ||
    typeof body.value.rawNonce !== "string" ||
    typeof body.value.authorizationCode !== "string" ||
    body.value.authorizationCode.length < 16 ||
    body.value.authorizationCode.length > 16_384 ||
    (body.value.displayName !== undefined &&
      body.value.displayName !== null &&
      typeof body.value.displayName !== "string")
  ) {
    return apiError(400, "A valid Apple sign-in response is required.");
  }

  const exchange = await exchangeAppleIdentity(
    body.value.identityToken,
    body.value.authorizationCode,
    body.value.rawNonce,
    typeof body.value.displayName === "string" ? body.value.displayName : null,
  );
  if (!exchange.ok) return exchange.response;
  return apiJson({
    accessToken: exchange.accessToken,
    expiresAt: exchange.expiresAt.toISOString(),
    displayName: exchange.displayName,
  });
}
