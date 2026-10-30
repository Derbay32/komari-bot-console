import { after, afterEach, beforeEach, describe, it } from "node:test";
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
  readDatabaseBytes,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const modules = await loadMaintenanceModules();
let routes;
let temp;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-api-test-");
  await configureAuthEnv({ databasePath: temp.databasePath });
  routes = await loadMaintenanceRoutes(modules);
});

afterEach(async () => {
  clearAuthEnv();
  await temp.cleanup();
});

after(() => {
  clearAuthEnv();
});

describe("console announcement routes", () => {
  it("authorizes before parsing input, creating tasks, or resolving upstream", async () => {
    const anonymous = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      headers: { "x-request-id": "api-auth-first" },
    });
    assert.equal(anonymous.status, 403);
    assert.deepEqual(await anonymous.json(), {
      message: "请求来源校验失败。",
    });

    const anonymousRead = await callList("GET");
    assert.equal(anonymousRead.status, 401);
    assert.deepEqual(await anonymousRead.json(), {
      code: "CONSOLE_UNAUTHENTICATED",
      message: "未登录或会话已过期。",
    });

    const login = await loginRequest(routes.loginRoute);
    const cookie = sessionCookie(login);
    const missingOrigin = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie,
      headers: { "x-request-id": "api-auth-first" },
    });
    assert.equal(missingOrigin.status, 403);

    const list = await callList("GET", { cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { notices: [] });

    const badKey = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie,
      headers: { "x-request-id": "bad key" },
      origin: TEST_ORIGIN,
    });
    assert.equal(badKey.status, 400);
    assert.match((await badKey.json()).message, /X-Request-ID/);
  });

  it("creates a local task and returns it without any delivery-success claim", async () => {
    const cookie = await loginCookie();
    const response = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie,
      headers: { "x-request-id": "api-create-key" },
      origin: TEST_ORIGIN,
    });

    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const payload = await response.json();
    assert.equal(payload.notice.status, "upcoming");
    assert.equal(payload.notice.activity, "queued");
    assert.equal(payload.notice.attemptCount, 1);
    assert.equal(payload.notice.aggregate.allSuccess, false);

    const bodyText = JSON.stringify(payload);
    assert.equal(bodyText.includes(TEST_BACKEND_TOKEN), false);
    assert.equal(bodyText.includes("Authorization"), false);
    assert.equal(bodyText.includes(temp.databasePath), false);

    const list = await callList("GET", { cookie });
    const listPayload = await list.json();
    assert.equal(listPayload.notices.length, 1);
    assert.equal(listPayload.notices[0].id, payload.notice.id);

    const detail = await callDetail(cookie, payload.notice.id);
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get("cache-control"), "no-store, private");
    const detailPayload = await detail.json();
    assert.equal(detailPayload.notice.attempts.length, 1);
    assert.equal(detailPayload.notice.attempts[0].phase, "queued");
    assert.deepEqual(detailPayload.notice.attempts[0].targetGroupIds, [101, 202]);
  });

  it("accepts a future scheduled task and rejects an equal-now plan", async () => {
    const cookie = await loginCookie();
    const plannedAt = Date.now() + 10 * 60_000;
    const response = await callList("POST", {
      body: JSON.stringify(
        maintenanceInput({ mode: "scheduled", plannedAt }),
      ),
      cookie,
      headers: { "x-request-id": "api-scheduled-create-key" },
      origin: TEST_ORIGIN,
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.notice.mode, "scheduled");
    assert.equal(payload.notice.plannedAt, plannedAt);
    assert.equal(payload.notice.status, "upcoming");
    assert.equal(payload.notice.maintenanceTime, "2026-11-01 22:00 - 23:00");

    const list = await callList("GET", { cookie });
    const listPayload = await list.json();
    assert.equal(listPayload.notices.length, 1);
    assert.equal(listPayload.notices[0].plannedAt, plannedAt);

    const equalNow = await callList("POST", {
      body: JSON.stringify(
        maintenanceInput({ mode: "scheduled", plannedAt: Date.now() }),
      ),
      cookie,
      headers: { "x-request-id": "api-scheduled-equal-now-key" },
      origin: TEST_ORIGIN,
    });
    assert.equal(equalNow.status, 400);
    assert.match((await equalNow.json()).message, /计划发送时间/);

    const after = await callList("GET", { cookie });
    assert.equal((await after.json()).notices.length, 1);
  });

  it("accepts the representable Date limit as a future planned time", async () => {
    const cookie = await loginCookie();
    const plannedAt = 8_640_000_000_000_000;
    const response = await callList("POST", {
      body: JSON.stringify(
        maintenanceInput({ mode: "scheduled", plannedAt }),
      ),
      cookie,
      headers: { "x-request-id": "api-scheduled-max-date-key" },
      origin: TEST_ORIGIN,
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.notice.plannedAt, plannedAt);
    assert.equal(payload.notice.status, "upcoming");
  });

  it("replays identical submissions and conflicts on changed normalized input", async () => {
    const cookie = await loginCookie();
    const first = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie,
      headers: { "x-request-id": "api-replay-key" },
      origin: TEST_ORIGIN,
    });
    const firstPayload = await first.json();

    const replay = await callList("POST", {
      body: JSON.stringify(
        maintenanceInput({
          content: " 预计维护 10 分钟\n期间可能出现短暂不可用 ",
          title: " Komari 服务维护通知 ",
        }),
      ),
      cookie,
      headers: { "x-request-id": "api-replay-key" },
      origin: TEST_ORIGIN,
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).notice.id, firstPayload.notice.id);

    const conflict = await callList("POST", {
      body: JSON.stringify(maintenanceInput({ groupIds: [999] })),
      cookie,
      headers: { "x-request-id": "api-replay-key" },
      origin: TEST_ORIGIN,
    });
    assert.equal(conflict.status, 409);
    const conflictText = await conflict.text();
    assert.match(JSON.parse(conflictText).message, /提交标识/);
    assert.equal(conflictText.includes(TEST_BACKEND_TOKEN), false);

    const list = await callList("GET", { cookie });
    assert.equal((await list.json()).notices.length, 1);
  });

  it("returns 400 for malformed, oversized, unknown, or invalid scheduling input", async () => {
    const cookie = await loginCookie();
    const cases = [
      { body: "{not json", key: "api-bad-json" },
      {
        body: JSON.stringify({ ...maintenanceInput(), extra: true }),
        key: "api-extra-field",
      },
      {
        body: JSON.stringify(
          maintenanceInput({
            mode: "scheduled",
            plannedAt: Date.now() - 1_000,
          }),
        ),
        key: "api-scheduled-past",
      },
      {
        body: JSON.stringify(
          maintenanceInput({ mode: "scheduled", plannedAt: null }),
        ),
        key: "api-scheduled-missing",
      },
      {
        body: JSON.stringify(
          maintenanceInput({
            mode: "scheduled",
            plannedAt: Number.MAX_SAFE_INTEGER,
          }),
        ),
        key: "api-scheduled-max-safe",
      },
      {
        body: JSON.stringify(
          maintenanceInput({
            mode: "scheduled",
            plannedAt: 8_640_000_000_000_001,
          }),
        ),
        key: "api-scheduled-beyond-date",
      },
      {
        body: JSON.stringify(maintenanceInput({ groupIds: [1, 1] })),
        key: "api-duplicate-groups",
      },
    ];

    for (const entry of cases) {
      const response = await callList("POST", {
        body: entry.body,
        cookie,
        headers: { "x-request-id": entry.key },
        origin: TEST_ORIGIN,
      });
      assert.equal(response.status, 400, entry.key);
      assert.equal(typeof (await response.json()).message, "string");
    }

    const tooLarge = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie,
      headers: {
        "content-length": String(70_000),
        "x-request-id": "api-too-large",
      },
      origin: TEST_ORIGIN,
    });
    assert.equal(tooLarge.status, 400);

    const list = await callList("GET", { cookie });
    assert.deepEqual(await list.json(), { notices: [] });
  });

  it("returns 404 for unknown notices and 401 for unauthenticated detail reads", async () => {
    const anonymous = await callDetail(null, "missing");
    assert.equal(anonymous.status, 401);

    const cookie = await loginCookie();
    const missing = await callDetail(cookie, "does-not-exist");
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { message: "通知不存在。" });
  });

  it("shows history to a new login session and never persists the bearer token", async () => {
    const firstCookie = await loginCookie();
    const created = await callList("POST", {
      body: JSON.stringify(maintenanceInput()),
      cookie: firstCookie,
      headers: { "x-request-id": "api-independent-key" },
      origin: TEST_ORIGIN,
    });
    const noticeId = (await created.json()).notice.id;

    const secondLogin = await loginRequest(routes.loginRoute, {
      password: "correct-horse-battery-staple",
    });
    const secondCookie = sessionCookie(secondLogin);
    const detail = await callDetail(secondCookie, noticeId);

    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).notice.id, noticeId);

    const bytes = readDatabaseBytes(temp.databasePath);
    assert.equal(bytes.includes(Buffer.from(TEST_BACKEND_TOKEN)), false);
  });

  it("serves create, list, and detail without resolving upstream config or fetching", async () => {
    delete process.env.KOMARI_API_ORIGIN;
    delete process.env.KOMARI_API_BEARER_TOKEN;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("HTTP route must not call upstream");
    };

    try {
      const cookie = await loginCookie();
      const created = await callList("POST", {
        body: JSON.stringify(maintenanceInput()),
        cookie,
        headers: { "x-request-id": "api-local-only-key" },
        origin: TEST_ORIGIN,
      });
      assert.equal(created.status, 201);
      const noticeId = (await created.json()).notice.id;

      const list = await callList("GET", { cookie });
      assert.equal(list.status, 200);
      const detail = await callDetail(cookie, noticeId);
      assert.equal(detail.status, 200);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps generic error responses free of internal database detail", async () => {
    clearAuthEnv();
    const response = await callList("GET");
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { message: "控制台认证配置不可用。" });
    assert.equal(body.includes("sqlite"), false);
    assert.equal(body.includes(temp.databasePath), false);
  });
});

async function loginCookie() {
  const login = await loginRequest(routes.loginRoute);
  return sessionCookie(login);
}

function callList(method, options = {}) {
  const headers = {
    ...(options.headers ?? {}),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.body ? { "content-type": "application/json" } : {}),
  };

  return routes.listRoute[method](
    new NextRequest(`${TEST_ORIGIN}/api/console/announcements`, {
      body: options.body,
      headers,
      method,
    }),
  );
}

function callDetail(cookie, id) {
  const headers = cookie ? { cookie } : {};

  return routes.detailRoute.GET(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}`,
      { headers },
    ),
    { params: Promise.resolve({ id }) },
  );
}
