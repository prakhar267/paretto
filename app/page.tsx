import { headers } from "next/headers";
import ParettoApp from "./ParettoApp";
import ProgressIdentityGate from "./ProgressIdentityGate";
import { getPublishedCurriculum } from "./published-curriculum.server";
import { resolveBrowserProgressCacheIdentity } from "./server-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [publishedCurriculum, requestHeaders] = await Promise.all([
    getPublishedCurriculum(),
    headers(),
  ]);
  const cacheIdentity = await resolveBrowserProgressCacheIdentity(
    requestFromHeaders(requestHeaders),
  );

  if (!cacheIdentity.ok) {
    return <ProgressIdentityGate rotateAnonymousProfile={false} />;
  }
  if (cacheIdentity.identity.kind === "reset-anonymous") {
    return <ProgressIdentityGate rotateAnonymousProfile />;
  }

  return (
    <ParettoApp
      storageKey={cacheIdentity.identity.storageKey}
      legacyCachePolicy={cacheIdentity.identity.legacyCachePolicy}
      serverAccountId={cacheIdentity.identity.accountId}
      publishedRecords={publishedCurriculum.records}
      courseId={publishedCurriculum.course.id}
      curriculumRevision={publishedCurriculum.revision}
      curriculumSource={publishedCurriculum.source}
    />
  );
}

function requestFromHeaders(requestHeaders: Headers): Request {
  const host = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000"
  )
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  return new Request(new URL("/", `${protocol}://${host}`), {
    headers: requestHeaders,
  });
}
