import PasAPasApp from "./PasAPasApp";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublishedCurriculum } from "./published-curriculum.server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const hostname = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();
  const localPreview = hostname === "localhost" || hostname === "127.0.0.1";
  const user = await getChatGPTUser();

  if (!user && !localPreview) redirect(chatGPTSignInPath("/"));

  const identity = user?.email.trim().toLowerCase() ?? "local-preview-user";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`pas-a-pas-cache:${identity}`),
  );
  const storageNamespace = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  const publishedCurriculum = await getPublishedCurriculum();

  return (
    <PasAPasApp
      storageKey={`pas-a-pas-progress-v1:${storageNamespace}`}
      publishedRecords={publishedCurriculum.records}
      curriculumRevision={publishedCurriculum.revision}
    />
  );
}
