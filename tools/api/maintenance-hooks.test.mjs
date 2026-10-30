import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const client = await import(clientUrl);
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

describe("announcement hooks", () => {
  it("lists groups through the v2 path with no v1 fallback", async () => {
    fetchHandler = () =>
      jsonResponse({
        groups: [
          {
            bot_ids: ["bot-1"],
            group_id: 101,
            group_name: "测试群",
            member_count: 12,
          },
        ],
        total: 1,
        unavailable_bot_count: 0,
      });
    resetCapturedHooks();

    hooks.useGroupList();
    assert.equal(capturedQueries.length, 1);
    const config = capturedQueries[0];
    assert.deepEqual(config.queryKey, ["announce", "groups"]);

    const data = await config.queryFn();
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "/api/proxy/api/v2/komari-announce/groups",
    );
    assert.equal(requests[0].cache, "no-store");
    assert.equal(data.total, 1);

    const source = readFileSync(
      new URL("../../src/lib/hooks/use-announce.ts", import.meta.url),
      "utf8",
    );
    assert.equal(source.includes("komari-announce/v1/groups"), false);
    assert.equal(
      source.includes("/api/komari-announce/maintenance"),
      false,
    );
    assert.equal(
      source.includes("/api/v2/komari-announce/maintenance"),
      false,
    );
    assert.equal(source.includes("useSendMaintenanceAnnounce"), false);
  });

  it("polls the local task list only while an attempt is queued or running", async () => {
    const queued = {
      notices: [noticeSummary({ activity: "queued" })],
    };
    fetchHandler = () => jsonResponse(queued);
    resetCapturedHooks();

    hooks.useAnnouncementList();
    const config = capturedQueries[0];
    assert.deepEqual(config.queryKey, ["announce", "notices"]);
    const data = await config.queryFn();
    assert.equal(requests[0].url, "/api/console/announcements");
    assert.equal(requests[0].cache, "no-store");
    assert.deepEqual(data, queued);
    assert.equal(
      config.refetchInterval({ state: { data: queued } }),
      2000,
    );
    assert.equal(
      config.refetchInterval({
        state: { data: { notices: [noticeSummary({ activity: null })] } },
      }),
      false,
    );
  });

  it("loads notice details only for a selected id and polls every open detail", async () => {
    const detail = { notice: { ...noticeSummary(), attempts: [] } };
    fetchHandler = () => jsonResponse(detail);
    resetCapturedHooks();

    hooks.useAnnouncementDetail(null);
    assert.equal(capturedQueries[0].enabled, false);
    assert.equal(
      capturedQueries[0].refetchInterval({ state: { data: undefined } }),
      false,
    );

    resetCapturedHooks();
    hooks.useAnnouncementDetail("notice/1");
    const config = capturedQueries[0];
    assert.deepEqual(config.queryKey, ["announce", "notice", "notice/1"]);
    assert.equal(config.enabled, true);
    assert.equal(config.refetchOnMount, "always");
    assert.equal(config.refetchIntervalInBackground, false);
    const data = await config.queryFn();
    assert.equal(
      requests[0].url,
      "/api/console/announcements/notice%2F1",
    );
    assert.equal(
      config.refetchInterval({ state: { data } }),
      2000,
    );
    assert.equal(
      config.refetchInterval({
        state: {
          data: {
            notice: {
              ...noticeSummary({ activity: null, status: "sent" }),
              attempts: [],
            },
          },
        },
      }),
      2000,
    );
  });

  it("stops polling and invalidates the list when a detail is missing", async () => {
    const notFound = new client.ApiError(
      404,
      { message: "通知不存在。" },
      "通知不存在。",
    );
    fetchHandler = () => jsonResponse({ message: "通知不存在。" }, 404);
    resetCapturedHooks();

    hooks.useAnnouncementDetail("notice-gone");
    const config = capturedQueries[0];

    await assert.rejects(config.queryFn(), (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 404);
      return true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(invalidations, [["announce", "notices"]]);
    assert.equal(config.retry(0, notFound), false);
    assert.equal(
      config.refetchInterval({ state: { error: notFound } }),
      false,
    );
  });

  it("keeps the project retry policy and polling for non-404 detail failures", async () => {
    const failure = new client.ApiError(500, { message: "读取失败。" });
    const notFound = new client.ApiError(404, { message: "通知不存在。" });
    fetchHandler = () => jsonResponse({ message: "读取失败。" }, 500);
    resetCapturedHooks();

    hooks.useAnnouncementDetail("notice-1");
    const config = capturedQueries[0];

    await assert.rejects(config.queryFn(), (error) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.status, 500);
      return true;
    });
    assert.deepEqual(invalidations, []);

    assert.equal(config.retry(0, failure), true);
    assert.equal(config.retry(1, failure), false);
    assert.equal(config.retry(0, notFound), false);
    assert.equal(config.refetchInterval({ state: { error: failure } }), 2000);
    assert.equal(config.refetchInterval({ state: {} }), 2000);
  });

  it("creates tasks through the local console API with the submission key", async () => {
    fetchHandler = () => jsonResponse({ notice: noticeSummary() }, 201);
    resetCapturedHooks();

    hooks.useCreateAnnouncement();
    const config = capturedMutations[0];
    const input = maintenance.parseMaintenanceCreateInput({
      content: "维护内容",
      groupIds: [101],
      maintenanceTime: "2026-11-01 22:00",
      mode: "immediate",
      plannedAt: null,
      title: "维护标题",
    });
    const data = await config.mutationFn({
      input,
      submissionId: "hook-submission-key",
    });
    config.onSuccess(data, undefined, undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/api/console/announcements");
    assert.equal(requests[0].headers.get("x-request-id"), "hook-submission-key");
    assert.deepEqual(JSON.parse(requests[0].body), input);
    assert.deepEqual(invalidations, [
      ["announce", "notices"],
      ["announce", "notice"],
    ]);
  });

  it("propagates console API status and payload through ApiError", async () => {
    fetchHandler = () =>
      jsonResponse({ message: "提交标识已被不同的通知内容使用。" }, 409);

    await assert.rejects(
      client.consoleFetch("/announcements", { method: "POST", body: {} }),
      (error) => {
        assert.equal(error.name, "ApiError");
        assert.equal(error.status, 409);
        assert.equal(error.message, "提交标识已被不同的通知内容使用。");
        assert.deepEqual(error.payload, {
          message: "提交标识已被不同的通知内容使用。",
        });
        return true;
      },
    );
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
