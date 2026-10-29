import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  capturedMutations,
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
const maintenance = await import(maintenanceUrl);

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

describe("announcement edit and cancel hooks", () => {
  it("updates a notice through the local console API and invalidates list and detail", async () => {
    fetchHandler = () =>
      jsonResponse({ notice: noticeSummary({ title: "新版标题", version: 2 }) });
    resetCapturedHooks();

    hooks.useUpdateAnnouncement();
    const config = capturedMutations[0];
    const input = maintenance.parseMaintenanceUpdateInput({
      content: "新版正文",
      groupIds: [101],
      maintenanceTime: "2026-11-01 22:00",
      mode: "immediate",
      plannedAt: null,
      title: "新版标题",
      version: 1,
    });
    const data = await config.mutationFn({ id: "notice/1", input });
    config.onSuccess(data, undefined, undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "PATCH");
    assert.equal(
      requests[0].url,
      "/api/console/announcements/notice%2F1",
    );
    assert.equal(requests[0].cache, "no-store");
    assert.equal(requests[0].headers.get("content-type"), "application/json");
    assert.equal(requests[0].headers.get("x-request-id"), null);
    assert.deepEqual(JSON.parse(requests[0].body), input);
    assert.equal(JSON.parse(requests[0].body).version, 1);
    assert.deepEqual(invalidations, [
      ["announce", "notices"],
      ["announce", "notice"],
    ]);
  });

  it("cancels a notice with only the version and invalidates list and detail", async () => {
    fetchHandler = () =>
      jsonResponse({ notice: noticeSummary({ status: "canceled", version: 4 }) });
    resetCapturedHooks();

    hooks.useCancelAnnouncement();
    const config = capturedMutations[0];
    const data = await config.mutationFn({ id: "notice-1", version: 3 });
    config.onSuccess(data, undefined, undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url,
      "/api/console/announcements/notice-1/cancel",
    );
    assert.equal(requests[0].cache, "no-store");
    assert.deepEqual(JSON.parse(requests[0].body), { version: 3 });
    assert.deepEqual(invalidations, [
      ["announce", "notices"],
      ["announce", "notice"],
    ]);
  });

  it("refreshes cached state on a 409 conflict without retrying or mutating the payload", async () => {
    fetchHandler = () =>
      jsonResponse(
        {
          currentNotice: noticeSummary({ status: "sent", version: 2 }),
          message: "通知已被更新，请刷新后重试。",
        },
        409,
      );
    resetCapturedHooks();

    hooks.useUpdateAnnouncement();
    const config = capturedMutations[0];
    const input = maintenance.parseMaintenanceUpdateInput({
      content: "维护内容",
      groupIds: [101],
      maintenanceTime: "2026-11-01 22:00",
      mode: "immediate",
      plannedAt: null,
      title: "维护标题",
      version: 1,
    });

    let caught;
    try {
      await config.mutationFn({ id: "notice-1", input });
    } catch (error) {
      caught = error;
    }

    assert.equal(caught?.name, "ApiError");
    assert.equal(caught?.status, 409);
    assert.equal(caught?.message, "通知已被更新，请刷新后重试。");
    const conflict = maintenance.readMaintenanceConflictPayload(caught?.payload);
    assert.equal(conflict?.currentNotice.version, 2);
    assert.equal(conflict?.currentNotice.status, "sent");

    config.onError(caught, undefined, undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(invalidations, [
      ["announce", "notices"],
      ["announce", "notice"],
    ]);
    assert.equal(requests.length, 1);
  });
});

function noticeSummary(patch = {}) {
  return {
    activity: "queued",
    aggregate: {
      allSuccess: false,
      blockedGroupIds: [],
      failed: 0,
      pending: 1,
      perGroup: [],
      requiresReconciliation: false,
      success: 0,
      total: 1,
      unknown: 0,
      unreachable: 0,
    },
    attemptCount: 1,
    content: "维护内容",
    createdAt: 1_800_000_000_000,
    endedAt: null,
    groupIds: [101],
    id: "notice-1",
    lastExecutedAttemptEndedAt: null,
    maintenanceTime: "2026-11-01 22:00",
    mode: "immediate",
    plannedAt: null,
    startedAt: null,
    status: "upcoming",
    title: "维护标题",
    updatedAt: 1_800_000_000_000,
    version: 1,
    ...patch,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
