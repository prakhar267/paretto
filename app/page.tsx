import PasAPasApp from "./PasAPasApp";
import { getPublishedCurriculum } from "./published-curriculum.server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const publishedCurriculum = await getPublishedCurriculum();

  return (
    <PasAPasApp
      storageKey="pas-a-pas-progress-v1:anonymous-browser"
      publishedRecords={publishedCurriculum.records}
      curriculumRevision={publishedCurriculum.revision}
    />
  );
}
