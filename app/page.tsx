import LoquivoApp from "./LoquivoApp";
import { getPublishedCurriculum } from "./published-curriculum.server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const publishedCurriculum = await getPublishedCurriculum();

  return (
    <LoquivoApp
      // Stable legacy persistence key: keep existing anonymous learners'
      // progress intact when their installed app updates to Loquivo.
      storageKey="pas-a-pas-progress-v1:anonymous-browser"
      publishedRecords={publishedCurriculum.records}
      curriculumRevision={publishedCurriculum.revision}
    />
  );
}
