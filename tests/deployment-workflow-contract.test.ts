import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  JSON_SCHEMA: unknown;
  load(source: string, options: { schema: unknown }): unknown;
};

type WorkflowStep = {
  name?: string;
  run?: string;
};

type WorkflowJob = {
  name?: string;
  env?: Record<string, string>;
  steps?: WorkflowStep[];
};

type WorkflowDocument = {
  on?: {
    workflow_dispatch?: {
      inputs?: Record<
        string,
        {
          default?: string;
          options?: string[];
          required?: boolean;
          type?: string;
        }
      >;
    };
  };
  jobs?: Record<string, WorkflowJob>;
};

async function readDeploymentWorkflow() {
  const source = await readFile(
    resolve(ROOT, ".github/workflows/deploy.yml"),
    "utf8",
  );
  const document = yaml.load(source, {
    schema: yaml.JSON_SCHEMA,
  }) as WorkflowDocument;
  return { document, source };
}

function namedStep(job: WorkflowJob, name: string): WorkflowStep {
  const matches = (job.steps ?? []).filter((step) => step.name === name);
  expect(
    matches,
    `Expected exactly one workflow step named ${name}`,
  ).toHaveLength(1);
  return matches[0];
}

function stepPosition(job: WorkflowJob, name: string): number {
  const position = (job.steps ?? []).findIndex((step) => step.name === name);
  expect(position, `Missing workflow step ${name}`).toBeGreaterThanOrEqual(0);
  return position;
}

describe("Cloudflare deployment workflow contract", () => {
  it("parses as YAML and rejects public-on-Free before expensive release gates", async () => {
    const { document } = await readDeploymentWorkflow();
    const inputs = document.on?.workflow_dispatch?.inputs;
    const releasePolicy = document.jobs?.["release-policy"];
    const deploy = document.jobs?.deploy;

    expect(inputs).toMatchObject({
      environment: {
        options: ["staging", "production"],
        required: true,
        type: "choice",
      },
      launch_mode: {
        default: "controlled-beta",
        options: ["controlled-beta", "public"],
        required: true,
        type: "choice",
      },
      workers_plan: {
        default: "free",
        options: ["free", "paid"],
        required: true,
        type: "choice",
      },
    });
    expect(releasePolicy?.env).toMatchObject({
      DEPLOY_ENVIRONMENT: "${{ inputs.environment }}",
      LAUNCH_MODE: "${{ inputs.launch_mode }}",
      WORKERS_PLAN: "${{ inputs.workers_plan }}",
    });
    expect(deploy?.env).toMatchObject({
      LAUNCH_MODE: "${{ inputs.launch_mode }}",
      WORKERS_PLAN: "${{ inputs.workers_plan }}",
    });
    expect(deploy?.name).toContain("Workers ${{ inputs.workers_plan }}");

    const launchContract = namedStep(
      releasePolicy ?? {},
      "Validate the requested launch contract",
    ).run;
    expect(launchContract).toContain(
      "controlled-beta:free|controlled-beta:paid|public:paid",
    );
    expect(launchContract).toContain("public:free)");
    expect(
      stepPosition(
        releasePolicy ?? {},
        "Validate the requested launch contract",
      ),
    ).toBeLessThan(stepPosition(releasePolicy ?? {}, "Use Node.js 24"));
  });

  it("propagates the declared Workers plan into the verified runtime configuration", async () => {
    const { document } = await readDeploymentWorkflow();
    const deploy = document.jobs?.deploy ?? {};
    const environmentGate = namedStep(
      deploy,
      "Validate protected environment configuration",
    ).run;
    const prepare = namedStep(
      deploy,
      "Prepare the environment-specific Worker configuration",
    ).run;

    expect(environmentGate).toContain('case "$WORKERS_PLAN" in');
    expect(environmentGate).toContain('[[ "$WORKERS_PLAN" != "paid" ]]');
    expect(prepare).toContain('--workers-plan "$WORKERS_PLAN"');
    expect(
      stepPosition(deploy, "Validate protected environment configuration"),
    ).toBeLessThan(
      stepPosition(
        deploy,
        "Prepare the environment-specific Worker configuration",
      ),
    );
    expect(
      stepPosition(
        deploy,
        "Prepare the environment-specific Worker configuration",
      ),
    ).toBeLessThan(stepPosition(deploy, "Verify Cloudflare identity"));
  });

  it("keeps the credential migration preflight read-only, fail-closed, and before backup or mutation", async () => {
    const { document } = await readDeploymentWorkflow();
    const deploy = document.jobs?.deploy ?? {};
    const preflightName =
      "Prove Paretto ID migration will not strand legacy credentials";
    const preflight = namedStep(deploy, preflightName).run ?? "";

    expect(stepPosition(deploy, preflightName)).toBeGreaterThan(
      stepPosition(deploy, "Verify Cloudflare identity"),
    );
    expect(stepPosition(deploy, preflightName)).toBeLessThan(
      stepPosition(
        deploy,
        "Capture and encrypt production D1 recovery evidence",
      ),
    );
    expect(
      stepPosition(
        deploy,
        "Retain production D1 recovery evidence before migration",
      ),
    ).toBeLessThan(stepPosition(deploy, "Apply verified D1 migrations"));

    expect(preflight).toContain(
      'migration_name="0013_paretto_id_recovery.sql"',
    );
    expect(preflight).toContain('test -f "drizzle/$migration_name"');
    expect(preflight).toContain(
      'mktemp -d "$RUNNER_TEMP/paretto-id-preflight.XXXXXX"',
    );
    expect(preflight).toContain("trap cleanup_preflight EXIT");
    expect(preflight).toContain('rmdir "$preflight_dir"');
    expect(preflight.match(/--remote/g)).toHaveLength(2);
    expect(preflight.match(/--config "\$config"/g)).toHaveLength(2);
    expect(preflight.match(/value\[0\]\?\.success !== true/g)).toHaveLength(2);
    expect(preflight).toContain("WHERE users.username IS NULL");

    const sqlStatements = [
      ...[...preflight.matchAll(/--command "(SELECT[^"]+)"/gi)].map(
        (match) => match[1],
      ),
      ...[...preflight.matchAll(/\bsql="([^"]+)"/g)].map((match) => match[1]),
    ];
    expect(sqlStatements).toHaveLength(3);
    for (const statement of sqlStatements) {
      expect(statement.trimStart()).toMatch(/^SELECT\b/i);
      expect(statement).not.toMatch(
        /\b(?:ALTER|CREATE|DELETE|DROP|INSERT|REPLACE|UPDATE|VACUUM)\b/i,
      );
    }
  });
});
