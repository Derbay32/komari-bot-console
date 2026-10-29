import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  capturedMutations,
  capturedQueries,
  configureQueryClient,
  resetCapturedHooks,
} from "./react-query-stub.mjs";
import { loadTypeScriptModule } from "./typescript-modules.mjs";

const queryStubUrl = new URL("./react-query-stub.mjs", import.meta.url).href;
const maintenanceUrl = loadTypeScriptModule("src/lib/maintenance.ts");
const asyncUrl = loadTypeScriptModule("src/lib/async.ts");
const clientUrl = loadTypeScriptModule("src/lib/http/client.ts");
const hooksUrl = loadTypeScriptModule("src/lib/hooks/use-announce.ts", {
  "@/lib/async": asyncUrl,
  "@/lib/http/client": clientUrl,
  "@/lib/maintenance": maintenanceUrl,
  "@tanstack/react-query": queryStubUrl,
});

const hooks = await import(hooksUrl);

const originalFetch = globalThis.fetch;
const invalidations = [];
const queryClient = {
  invalidateQueries({ queryKey }) {
    invalidations.push(queryKey);
    return Promise.resolve();
  },
};
let requests = [];
let fetchHandler = () => jsonResponse({});

beforeEach(() => {
  requests = [];
  invalidations.length = 0;
  resetCapturedHooks();
  configureQueryClient(queryClient);
  fetchHandler = () => jsonResponse({});
  globalThis.fetch = async (input, init = {}) => {
    const request = {
      body: init.body,
      cache: init.cache,
      headers: new Headers(init.headers),
      method: init.method,
      url: String(input),
    };
    requests.push(request);
    return fetchHandler(request);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("announcement retry hooks", () => {
  it("loads a stable retry preview through the confirmation session token", async () => {
    const preview = {
      blockedReason: null,
      content: "维护内容",
      maintenanceTime: "2026-11-01 22:00",
      noticeId: "notice/1",
      targetGroupIds: [103, 109],
      title: "维护标题",
      version: 3,
    };
    fetchHandler = () => jsonResponse({ preview });
    resetCapturedHooks();

    hooks.useRetryAnnouncementPreview("notice/1", "session-token");
    const config = capturedQueries[0];
    assert.deepEqual(config.queryKey, [
      "announce",
      "retry-preview",
      "notice/1",
      "session-token",
    ]);
    assert.equal(config.staleTime, Number.POSITIVE_INFINITY);
    assert.equal(config.refetchOnWindowFocus, false);
    assert.equal(config.refetchOnReconnect, false);

    const data = await config.queryFn();
    assert.equal(
      requests[0].url,
      "/api/console/announcements/notice%2F1/retry",
    );
    assert.equal(requests[0].cache, "no-store");
    assert.deepEqual(data, { preview });
  });

  it("submits the exact confirmed payload with one local submission key", async () => {
    fetchHandler = () => jsonResponse({ attemptId: "attempt-2", created: true });
    resetCapturedHooks();

    hooks.useRetryAnnouncement();
    const config = capturedMutations[0];
    const input = {
      groupIds: [103, 109],
      noticeId: "notice/1",
      submissionId: "retry-submission-key",
      version: 3,
    };
    const data = await config.mutationFn(input);
    config.onSuccess(data, undefined, undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url,
      "/api/console/announcements/notice%2F1/retry",
    );
    assert.equal(
      requests[0].headers.get("x-request-id"),
      "retry-submission-key",
    );
    assert.deepEqual(JSON.parse(requests[0].body), {
      groupIds: [103, 109],
      version: 3,
    });
    assert.deepEqual(invalidations, [
      ["announce", "notices"],
      ["announce", "notice"],
    ]);
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
