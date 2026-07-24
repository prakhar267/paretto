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
      if (path.includes("/api/admin/content")) return json({ entries: [], nextCursor: null });
      if (path.includes("/api/admin/support")) return json({ requests: [], nextCursor: null });
      if (path.includes("/api/admin/analytics")) {
        return json({
          window: { days: 30, from: "2026-06-20T00:00:00.000Z", to: "2026-07-20T00:00:00.000Z" },
          totals: { events: 0, activeLearners: 0, sessions: 0 },
          byEvent: [],
          daily: [],
          privacy: "Aggregate counts only; raw learner identifiers are never returned.",
        });
      }
      if (path.includes("/api/admin/legal-holds")) {
        return json({ holds: [], nextCursor: null });
      }
      if (path.includes("/api/admin/operations")) {
        return json(operationsSummary());
      }
      if (path.includes("/api/admin/audit")) {
        return json({ events: [], nextCursor: null });
      }
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
    render(<AdminConsole adminEmail="admin@loquivo.test" />);
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

  it("loads the next page of legal holds without replacing the first page", async () => {
    const cursor =
      "0:1784505600000:10000000-0000-4000-8000-000000000001";
    const firstHold = legalHold(
      "10000000-0000-4000-8000-000000000001",
      "First active hold",
    );
    const secondHold = legalHold(
      "20000000-0000-4000-8000-000000000002",
      "Second active hold",
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/admin/content")) {
        return json({ entries: [], nextCursor: null });
      }
      if (path.includes("/api/admin/operations")) {
        return json({ ...operationsSummary(), activeLegalHolds: 2 });
      }
      if (path.includes("/api/admin/legal-holds")) {
        return path.includes("cursor=")
          ? json({ holds: [secondHold], nextCursor: null })
          : json({ holds: [firstHold], nextCursor: cursor });
      }
      return json({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<AdminConsole adminEmail="admin@loquivo.test" />);
    await screen.findByRole("heading", { name: "Curriculum studio" });
    await user.click(screen.getByRole("button", { name: "Operations" }));

    expect(await screen.findByText("First active hold")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Load more legal holds" }),
    );

    expect(await screen.findByText("Second active hold")).toBeInTheDocument();
    expect(screen.getByText("First active hold")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(`cursor=${encodeURIComponent(cursor)}`),
      ),
    ).toBe(true);
  });
});

function operationsSummary() {
  return {
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
  };
}

function legalHold(id: string, reason: string) {
  return {
    id,
    dataClass: "product_events",
    recordKey: `account:${id.slice(0, 8)}`,
    reason,
    status: "active",
    createdByEmail: "admin@loquivo.test",
    createdAt: "2026-07-20T00:00:00.000Z",
    releasedByEmail: null,
    releasedAt: null,
  };
}

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
