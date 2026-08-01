import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("vinext/server/app-router-entry", () => ({
  default: handler,
}));

import worker from "../worker/index";

describe("Worker health routing", () => {
  beforeEach(() => {
    handler.fetch.mockReset();
  });

  it("canonicalizes HEAD probes without sharing request I/O and then caches the result", async () => {
    handler.fetch.mockImplementation(async (request: Request) => {
      expect(request.method).toBe("GET");
      await Promise.resolve();
      return Response.json(
        { status: "ok", service: "paretto-web" },
        {
          headers: {
            "cache-control": "private, no-store",
          },
        },
      );
    });
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const request = () =>
      new Request("https://paretto.example/api/health?cache-bust=ignored", {
        method: "HEAD",
      });

    const responses = await Promise.all([
      worker.fetch(request(), {} as never, context),
      worker.fetch(request(), {} as never, context),
      worker.fetch(request(), {} as never, context),
    ]);

    expect(handler.fetch).toHaveBeenCalledTimes(3);
    expect(
      handler.fetch.mock.calls.every(([request]) => request.method === "GET"),
    ).toBe(true);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
    }

    const getResponse = await worker.fetch(
      new Request("https://paretto.example/api/health", { method: "GET" }),
      {} as never,
      context,
    );
    expect(handler.fetch).toHaveBeenCalledTimes(3);
    expect(await getResponse.json()).toEqual({
      status: "ok",
      service: "paretto-web",
    });
  });

  it("redirects insecure requests to the same HTTPS URL before application code runs", async () => {
    const context = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const response = await worker.fetch(
      new Request("http://paretto.example/sign-in?returnTo=%2Fprofile", {
        method: "POST",
      }),
      {} as never,
      context,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://paretto.example/sign-in?returnTo=%2Fprofile",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(handler.fetch).not.toHaveBeenCalled();
  });
});
