// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminConsole from "../app/admin/AdminConsole";
import SupportForm from "../app/support/SupportForm";

describe("admin and learner-care accessibility", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/admin/content")) return json({ entries: [] });
      if (path.includes("/api/admin/support")) return json({ requests: [] });
      if (path.includes("/api/admin/analytics")) {
        return json({
          window: { days: 30, from: "2026-06-20T00:00:00.000Z", to: "2026-07-20T00:00:00.000Z" },
          totals: { events: 0, activeLearners: 0, sessions: 0 },
          byEvent: [],
          daily: [],
          privacy: "Aggregate counts only; raw learner identifiers are never returned.",
        });
      }
      if (path.includes("/api/admin/legal-holds")) return json({ holds: [] });
      if (path.includes("/api/admin/operations")) {
        return json({
          checkedAt: "2026-07-20T00:00:00.000Z",
          service: { status: "ready", healthPath: "/api/health" },
          configuration: {
            database: true,
            userKeySecret: true,
            adminAllowlist: true,
            appleClientId: true,
            appleServerCredentials: true,
            appleTokenEncryptionSecret: true,
            nativeSessionSecret: true,
          },
          content: { published: 0, drafts: 0 },
          support: { open: 0 },
          retentionDue: { productEvents: 0, supportRequests: 0, auditEvents: 0 },
          activeLegalHolds: 0,
          retentionBatchLimit: 500,
        });
      }
      if (path.includes("/api/admin/audit")) return json({ events: [] });
      return json({ error: "not found" }, 404);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps every administration tab free of automated WCAG A/AA violations", async () => {
    const user = userEvent.setup();
    render(<AdminConsole adminEmail="admin@pas-a-pas.test" />);
    await screen.findByRole("heading", { name: "Curriculum studio" });

    for (const tab of ["Curriculum", "Support", "Analytics", "Operations", "Audit log"]) {
      await user.click(screen.getByRole("button", { name: tab }));
      await waitFor(() => expect(screen.queryByText("Loading studio data…")).not.toBeInTheDocument());
      await expectNoAutomatedA11yViolations(document.body);
    }
  });

  it("keeps the public support form accessible", async () => {
    render(<SupportForm />);
    expect(screen.getByRole("heading", { name: "Create a support request" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Billing" })).not.toBeInTheDocument();
    await expectNoAutomatedA11yViolations(document.body);
  });
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectNoAutomatedA11yViolations(root: Element) {
  const results = await axe.run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);
}
