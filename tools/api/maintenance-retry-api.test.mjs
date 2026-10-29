import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NextRequest,
  TEST_ORIGIN,
  clearAuthEnv,
  configureAuthEnv,
  loginRequest,
  sessionCookie,
} from "./auth-fixtures.mjs";
import {
  createTempDatabase,
  loadMaintenanceModules,
  loadMaintenanceRoutes,
  maintenanceInput,
  readJsonBody,
  startFakeUpstream,
  successfulResponse,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const modules = await loadMaintenanceModules();
let routes;
let temp;
let upstream;
let now;
let service;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-retry-api-test-");
  configureAuthEnv({ databasePath: temp.databasePath });
  routes = await loadMaintenanceRoutes(modules);
  now = 1_800_000_000_000;
  upstream = await startFakeUpstream((request) => ({
    body: successfulResponse(readJsonBody(request).group_ids),
  }));
  service = modules.service.createMaintenanceService({
    databasePath: temp.databasePath,
    now: () => now,
    upstream: {
      apiOrigin: upstream.origin,
      bearerToken: TEST_BACKEND_TOKEN,
    },
  });
});

afterEach(async () => {
  clearAuthEnv();
  await upstream.close();
  await temp.cleanup();
});

describe("console retry routes", () => {
  it("authorizes preview and mutation before reading or writing local state", async () => {
    const anonymousPreview = await callRetry("GET", "missing", {});
    assert.equal(anonymousPreview.status, 401);

    const cookie = await loginCookie();
    const missing = await callRetry("GET", "missing", { cookie });
    assert.equal(missing.status, 404);

    const seeded = await seedFailedNotice([101, 102, 103, 104, 105, 106, 107, 108, 109, 110], [103, 109]);
    const requestsBefore = upstream.requests.length;
    const preview = await callRetry("GET", seeded.noticeId, { cookie });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("cache-control"), "no-store, private");
    const previewPayload = await preview.json();
    assert.equal(previewPayload.preview.noticeId, seeded.noticeId);
    assert.deepEqual(previewPayload.preview.targetGroupIds, [103, 109]);
    assert.equal(previewPayload.preview.blockedReason, null);

    const anonymousMutation = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify({
        groupIds: seeded.preview.targetGroupIds,
        version: seeded.preview.version,
      }),
      headers: { "x-request-id": "api-retry-anonymous" },
      origin: TEST_ORIGIN,
    });
    assert.equal(anonymousMutation.status, 401);

    const missingOrigin = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify({
        groupIds: seeded.preview.targetGroupIds,
        version: seeded.preview.version,
      }),
      cookie,
      headers: { "x-request-id": "api-retry-origin" },
    });
    assert.equal(missingOrigin.status, 403);

    const badKey = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify({
        groupIds: seeded.preview.targetGroupIds,
        version: seeded.preview.version,
      }),
      cookie,
      headers: { "x-request-id": "bad key" },
      origin: TEST_ORIGIN,
    });
    assert.equal(badKey.status, 400);
    assert.match((await badKey.json()).message, /X-Request-ID/);

    assert.equal(upstream.requests.length, requestsBefore);
  });

  it("accepts only the strict version and ordered target list", async () => {
    const seeded = await seedFailedNotice([101, 102, 103, 104, 105, 106, 107, 108, 109, 110], [103, 109]);
    const cookie = await loginCookie();
    const requestsBefore = upstream.requests.length;
    const validBody = {
      groupIds: seeded.preview.targetGroupIds,
      version: seeded.preview.version,
    };
    const invalidBodies = [
      { ...validBody, title: "篡改标题" },
      { ...validBody, content: "篡改正文" },
      { ...validBody, maintenanceTime: "篡改维护时间" },
      { ...validBody, targetGroupIds: [103] },
      { groupIds: seeded.preview.targetGroupIds, version: String(validBody.version) },
      { groupIds: seeded.preview.targetGroupIds, version: 0 },
      { groupIds: [], version: seeded.preview.version },
      { groupIds: [103, 103], version: seeded.preview.version },
      { groupIds: seeded.preview.targetGroupIds },
    ];

    for (const [index, body] of invalidBodies.entries()) {
      const response = await callRetry("POST", seeded.noticeId, {
        body: JSON.stringify(body),
        cookie,
        headers: { "x-request-id": `api-retry-invalid-${index}` },
        origin: TEST_ORIGIN,
      });
      assert.equal(response.status, 400, `invalid body ${index}`);
      assert.equal(typeof (await response.json()).message, "string");
    }

    const malformed = await callRetry("POST", seeded.noticeId, {
      body: "{not json",
      cookie,
      headers: { "x-request-id": "api-retry-malformed" },
      origin: TEST_ORIGIN,
    });
    assert.equal(malformed.status, 400);

    const staleVersion = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify({
        groupIds: seeded.preview.targetGroupIds,
        version: seeded.preview.version - 1,
      }),
      cookie,
      headers: { "x-request-id": "api-retry-stale-version" },
      origin: TEST_ORIGIN,
    });
    assert.equal(staleVersion.status, 409);

    for (const [index, groupIds] of [
      [109, 103],
      [103],
      [103, 109, 102],
    ].entries()) {
      const response = await callRetry("POST", seeded.noticeId, {
        body: JSON.stringify({
          groupIds,
          version: seeded.preview.version,
        }),
        cookie,
        headers: { "x-request-id": `api-retry-stale-list-${index}` },
        origin: TEST_ORIGIN,
      });
      assert.equal(response.status, 409, `stale list ${index}`);
      assert.match((await response.json()).message, /重试|名单|更新/);
    }

    const detail = await callDetail(seeded.noticeId, cookie);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).notice.attempts.length, 1);
    assert.equal(upstream.requests.length, requestsBefore);
  });

  it("creates one retry task and replays the same receipt", async () => {
    const seeded = await seedFailedNotice([101, 102, 103, 104, 105, 106, 107, 108, 109, 110], [103, 109]);
    const cookie = await loginCookie();
    const requestsBefore = upstream.requests.length;
    const body = {
      groupIds: seeded.preview.targetGroupIds,
      version: seeded.preview.version,
    };

    const created = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify(body),
      cookie,
      headers: { "x-request-id": "api-retry-create" },
      origin: TEST_ORIGIN,
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "no-store, private");
    const createdPayload = await created.json();
    assert.equal(createdPayload.created, true);
    assert.equal(createdPayload.notice.id, seeded.noticeId);
    assert.equal(createdPayload.notice.status, "sent");
    assert.equal(createdPayload.notice.attemptCount, 2);
    assert.match(createdPayload.attemptId, /^[0-9a-f-]{36}$/);

    const replay = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify(body),
      cookie,
      headers: { "x-request-id": "api-retry-create" },
      origin: TEST_ORIGIN,
    });
    assert.equal(replay.status, 200);
    const replayPayload = await replay.json();
    assert.equal(replayPayload.created, false);
    assert.equal(replayPayload.attemptId, createdPayload.attemptId);
    assert.equal(replayPayload.notice.attemptCount, 2);

    const conflict = await callRetry("POST", seeded.noticeId, {
      body: JSON.stringify({
        groupIds: [103],
        version: seeded.preview.version,
      }),
      cookie,
      headers: { "x-request-id": "api-retry-create" },
      origin: TEST_ORIGIN,
    });
    assert.equal(conflict.status, 409);

    const detail = await callDetail(seeded.noticeId, cookie);
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.notice.attempts.length, 2);
    assert.equal(detailPayload.notice.attempts[1].id, createdPayload.attemptId);
    assert.equal(detailPayload.notice.attempts[1].phase, "queued");
    assert.deepEqual(detailPayload.notice.attempts[1].targetGroupIds, [103, 109]);
    assert.equal(detailPayload.notice.attempts[1].auditReason, "手动重试维护通知");

    const list = await routes.listRoute.GET(
      new NextRequest(`${TEST_ORIGIN}/api/console/announcements`, {
        headers: { cookie },
      }),
    );
    assert.equal((await list.json()).notices.length, 1);
    assert.equal(upstream.requests.length, requestsBefore);
  });

  it("returns 404 for unknown notices and keeps error bodies sanitized", async () => {
    const cookie = await loginCookie();
    const missingMutation = await callRetry("POST", "does-not-exist", {
      body: JSON.stringify({ groupIds: [101], version: 1 }),
      cookie,
      headers: { "x-request-id": "api-retry-missing" },
      origin: TEST_ORIGIN,
    });
    assert.equal(missingMutation.status, 404);
    assert.deepEqual(await missingMutation.json(), { message: "通知不存在。" });

    const missingPreview = await callRetry("GET", "does-not-exist", { cookie });
    assert.equal(missingPreview.status, 404);
    const text = await missingPreview.text();
    assert.equal(text.includes(TEST_BACKEND_TOKEN), false);
    assert.equal(text.includes(temp.databasePath), false);
    assert.equal(text.includes("sqlite"), false);
  });
});

async function loginCookie() {
  const login = await loginRequest(routes.loginRoute);
  return sessionCookie(login);
}

async function seedFailedNotice(groupIds, failedGroupIds) {
  const created = await service.create(
    maintenanceInput({ groupIds }),
    `api-retry-seed-${Date.now()}-${Math.random()}`,
  );
  upstream.setHandler(() => ({
    body: {
      results: groupIds.map((groupId) =>
        failedGroupIds.includes(groupId)
          ? {
              bot_id: "bot-1",
              error: "平台拒绝发送",
              error_code: "send_failed",
              group_id: groupId,
              status: "failed",
              success: false,
            }
          : {
              bot_id: "bot-1",
              error: null,
              error_code: null,
              group_id: groupId,
              status: "success",
              success: true,
            },
      ),
      total: groupIds.length,
    },
  }));
  now += 1_000;
  await service.runOnce();
  const preview = await service.previewRetry(created.notice.id);
  assert.ok(preview);
  assert.deepEqual(preview.targetGroupIds, failedGroupIds);

  return { noticeId: created.notice.id, preview };
}

function callRetry(method, id, options = {}) {
  const headers = {
    ...(options.headers ?? {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.body ? { "content-type": "application/json" } : {}),
  };
  const request = new NextRequest(
    `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}/retry`,
    {
      body: options.body,
      headers,
      method,
    },
  );

  return routes.retryRoute[method](request, {
    params: Promise.resolve({ id }),
  });
}

function callDetail(id, cookie) {
  return routes.detailRoute.GET(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}`,
      { headers: { cookie } },
    ),
    { params: Promise.resolve({ id }) },
  );
}
