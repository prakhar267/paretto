const REQUIRED_CI_JOBS = [
  "Web release gate (Node 22.x)",
  "Web release gate (Node 24.x)",
  "Browser journeys (chromium)",
  "Browser journeys (firefox)",
  "Browser journeys (webkit)",
  "Windows-hosted Chromium compatibility (not device certification)",
  "Native iPhone and iPad release gate (Xcode 26.3)",
];

const repository = requiredEnvironment("GITHUB_REPOSITORY");
const sourceSha = requiredEnvironment("GITHUB_SHA").toLowerCase();
const releaseRef = requiredEnvironment("GITHUB_REF");
const releaseTag = requiredEnvironment("GITHUB_REF_NAME");
const token = requiredEnvironment("GITHUB_TOKEN");
const apiOrigin = new URL(
  process.env.GITHUB_API_URL?.trim() || "https://api.github.com",
);

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("GITHUB_REPOSITORY must be an exact owner/repository pair.");
}
if (!/^[a-f0-9]{40}$/.test(sourceSha)) {
  throw new Error("GITHUB_SHA must be a full 40-character commit SHA.");
}
if (
  !/^v[A-Za-z0-9._-]+$/.test(releaseTag) ||
  releaseRef !== `refs/tags/${releaseTag}`
) {
  throw new Error("Production CI evidence requires the selected v* tag ref.");
}
if (
  apiOrigin.protocol !== "https:" &&
  process.env.ALLOW_HTTP_GITHUB_API !== "1"
) {
  throw new Error("GITHUB_API_URL must use HTTPS.");
}

const encodedRepository = repository
  .split("/")
  .map(encodeURIComponent)
  .join("/");
const comparison = await githubJson(
  `/repos/${encodedRepository}/compare/${sourceSha}...main`,
);
if (
  !["ahead", "identical"].includes(comparison.status) ||
  comparison.base_commit?.sha?.toLowerCase() !== sourceSha
) {
  throw new Error(
    `Production tag SHA ${sourceSha} must be reachable from main.`,
  );
}
const runs = await githubJson(
  `/repos/${encodedRepository}/actions/workflows/ci.yml/runs` +
    `?head_sha=${sourceSha}&event=push&status=completed&per_page=100`,
);
const candidates = Array.isArray(runs.workflow_runs)
  ? runs.workflow_runs.filter(
      (run) =>
        run &&
        run.event === "push" &&
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.head_branch === releaseTag &&
        typeof run.head_sha === "string" &&
        run.head_sha.toLowerCase() === sourceSha &&
        Number.isSafeInteger(run.id),
    )
  : [];
if (candidates.length === 0) {
  throw new Error(
    `Production requires a successful completed CI push run for exact SHA ${sourceSha}.`,
  );
}

candidates.sort((left, right) => right.id - left.id);
const run = candidates[0];
const jobDocument = await githubJson(
  `/repos/${encodedRepository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
);
const jobs = Array.isArray(jobDocument.jobs) ? jobDocument.jobs : [];
for (const requiredName of REQUIRED_CI_JOBS) {
  const matches = jobs.filter((job) => job?.name === requiredName);
  if (
    matches.length !== 1 ||
    matches[0].status !== "completed" ||
    matches[0].conclusion !== "success"
  ) {
    throw new Error(
      `Exact-SHA CI run ${run.id} is missing successful job: ${requiredName}.`,
    );
  }
}

console.log(
  JSON.stringify({
    status: "verified",
    repository,
    sourceSha,
    releaseTag,
    workflowRunId: run.id,
    workflowRunUrl: run.html_url,
    requiredJobs: REQUIRED_CI_JOBS.length,
  }),
);

async function githubJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(new URL(path, apiOrigin), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "Paretto exact-SHA release verifier/1",
        "x-github-api-version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `GitHub Actions evidence request failed with HTTP ${response.status}.`,
      );
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}.`);
  return value;
}
