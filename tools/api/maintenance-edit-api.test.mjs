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
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const modules = await loadMaintenanceModules();
let routes;
let temp;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-edit-api-");
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

describe("console announcement edit endpoint", () => {
  it("authorizes and checks the exact origin before reading params or the body", async () => {
    const anonymousNoOrigin = await callPatch(null, "missing", "{not json", {
      origin: null,
    });
    assert.equal(anonymousNoOrigin.status, 403);

    const anonymous = await callPatch(null, "missing", "{not json");
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), {
      code: "CONSOLE_UNAUTHENTICATED",
      message: "未登录或会话已过期。",
    });

    const cookie = await loginCookie();
    const missingOrigin = await callPatch(cookie, "missing", "{not json", {
      origin: null,
    });
    assert.equal(missingOrigin.status, 403);

    const anonymousCancel = await callCancel(null, "missing", "{not json");
    assert.equal(anonymousCancel.status, 401);
    const anonymousCancelNoOrigin = await callCancel(
      null,
      "missing",
      "{not json",
      { origin: null },
    );
    assert.equal(anonymousCancelNoOrigin.status, 403);
    const cancelMissingOrigin = await callCancel(
      cookie,
      "missing",
      "{not json",
      { origin: null },
    );
    assert.equal(cancelMissingOrigin.status, 403);

    const list = await routes.listRoute.GET(
      new NextRequest(`${TEST_ORIGIN}/api/console/announcements`, {
        headers: { cookie },
      }),
    );
    assert.deepEqual(await list.json(), { notices: [] });
  });

  it("updates an upcoming notice in place and returns the new state with no-store", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-edit-success");
    const plannedAt = Date.now() + 10 * 60_000;
    const response = await callPatch(cookie, created.id, {
      ...maintenanceInput({
        content: "接口修改正文",
        groupIds: [55, 66],
        maintenanceTime: "2027-01-01 08:00 - 09:00",
        mode: "scheduled",
        plannedAt,
        title: "接口修改标题",
      }),
      version: created.version,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const payload = await response.json();
    assert.equal(payload.notice.id, created.id);
    assert.equal(payload.notice.title, "接口修改标题");
    assert.equal(payload.notice.version, 2);
    assert.equal(payload.notice.status, "upcoming");
    assert.equal(payload.notice.mode, "scheduled");
    assert.equal(payload.notice.plannedAt, plannedAt);
    assert.equal(payload.notice.attemptCount, 1);
    assert.equal(JSON.stringify(payload).includes(TEST_BACKEND_TOKEN), false);

    const detail = await callDetail(cookie, created.id);
    const detailPayload = await detail.json();
    assert.deepEqual(detailPayload.notice.groupIds, [55, 66]);
    assert.equal(detailPayload.notice.attempts.length, 1);
    assert.deepEqual(detailPayload.notice.attempts[0].requestBody, {
      content: "接口修改正文",
      group_ids: [55, 66],
      scheduled_time: "2027-01-01 08:00 - 09:00",
      title: "接口修改标题",
    });
  });

  it("returns 409 with the server's current notice for a stale version", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-edit-conflict");
    const firstEdit = await callPatch(cookie, created.id, {
      ...maintenanceInput({ title: "第一次修改" }),
      version: created.version,
    });
    assert.equal(firstEdit.status, 200);

    const stale = await callPatch(cookie, created.id, {
      ...maintenanceInput({ title: "过期修改" }),
      version: created.version,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get("cache-control"), "no-store, private");
    const text = await stale.text();
    const payload = JSON.parse(text);
    assert.equal(typeof payload.message, "string");
    assert.equal(payload.currentNotice.id, created.id);
    assert.equal(payload.currentNotice.version, 2);
    assert.equal(payload.currentNotice.title, "第一次修改");
    assert.equal(payload.currentNotice.status, "upcoming");
    assert.equal(text.includes(TEST_BACKEND_TOKEN), false);
    assert.equal(text.includes(temp.databasePath), false);

    const fresh = await callPatch(cookie, created.id, {
      ...maintenanceInput({ title: "使用新版本修改" }),
      version: payload.currentNotice.version,
    });
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).notice.title, "使用新版本修改");
  });

  it("returns 400 for invalid edit input and 404 for a missing notice without changing state", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-edit-invalid");

    const cases = [
      { body: "{not json", label: "malformed" },
      {
        body: JSON.stringify({
          ...maintenanceInput(),
          extra: true,
          version: created.version,
        }),
        label: "unknown-field",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput(),
          version: 0,
        }),
        label: "version-zero",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput(),
          version: 1.5,
        }),
        label: "version-fraction",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput(),
          version: "1",
        }),
        label: "version-string",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput({ title: "维".repeat(129) }),
          version: created.version,
        }),
        label: "title-budget",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput({ content: "护".repeat(3001) }),
          version: created.version,
        }),
        label: "content-budget",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput({ groupIds: [] }),
          version: created.version,
        }),
        label: "empty-groups",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput({
            mode: "scheduled",
            plannedAt: Date.now(),
          }),
          version: created.version,
        }),
        label: "scheduled-now",
      },
      {
        body: JSON.stringify({
          ...maintenanceInput({
            mode: "scheduled",
            plannedAt: Date.now() - 1_000,
          }),
          version: created.version,
        }),
        label: "scheduled-past",
      },
    ];

    for (const entry of cases) {
      const response = await callPatch(cookie, created.id, entry.body);
      assert.equal(response.status, 400, entry.label);
      assert.equal(typeof (await response.json()).message, "string", entry.label);
    }

    const oversized = await routes.detailRoute.PATCH(
      new NextRequest(
        `${TEST_ORIGIN}/api/console/announcements/${created.id}`,
        {
          body: JSON.stringify({
            ...maintenanceInput(),
            version: created.version,
          }),
          headers: {
            "content-length": "70000",
            "content-type": "application/json",
            cookie,
            origin: TEST_ORIGIN,
          },
          method: "PATCH",
        },
      ),
      { params: Promise.resolve({ id: created.id }) },
    );
    assert.equal(oversized.status, 400);

    const detail = await callDetail(cookie, created.id);
    const unchanged = await detail.json();
    assert.equal(unchanged.notice.version, created.version);
    assert.equal(unchanged.notice.title, created.title);
    assert.deepEqual(unchanged.notice.attempts[0].targetGroupIds, [101, 202]);

    const missing = await callPatch(cookie, "does-not-exist", {
      ...maintenanceInput(),
      version: 1,
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { message: "通知不存在。" });
  });

  it("rejects an edit after the notice was canceled", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-edit-after-cancel");
    const canceled = await callCancel(cookie, created.id, {
      version: created.version,
    });
    assert.equal(canceled.status, 200);

    const response = await callPatch(cookie, created.id, {
      ...maintenanceInput({ title: "取消后再改" }),
      version: created.version,
    });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.currentNotice.status, "canceled");
    assert.equal(payload.currentNotice.version, 2);
  });
});

describe("console announcement cancel endpoint", () => {
  it("cancels once, returns the canceled notice, and refuses stale or repeated cancellation", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-cancel-success");
    const response = await callCancel(cookie, created.id, {
      version: created.version,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    const payload = await response.json();
    assert.equal(payload.notice.id, created.id);
    assert.equal(payload.notice.status, "canceled");
    assert.equal(payload.notice.version, 2);
    assert.equal(payload.notice.endedAt, payload.notice.updatedAt);
    assert.equal(payload.notice.lastExecutedAttemptEndedAt, null);
    assert.equal(payload.notice.activity, null);

    const repeated = await callCancel(cookie, created.id, {
      version: created.version,
    });
    assert.equal(repeated.status, 409);
    const repeatedPayload = await repeated.json();
    assert.equal(repeatedPayload.currentNotice.status, "canceled");
    assert.equal(repeatedPayload.currentNotice.version, 2);

    const withCurrentVersion = await callCancel(cookie, created.id, {
      version: repeatedPayload.currentNotice.version,
    });
    assert.equal(withCurrentVersion.status, 409);
    assert.equal(
      (await withCurrentVersion.json()).currentNotice.status,
      "canceled",
    );

    const detail = await callDetail(cookie, created.id);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.notice.attempts.length, 1);
    assert.equal(detailPayload.notice.attempts[0].phase, "completed");
    assert.equal(detailPayload.notice.attempts[0].executed, false);
    assert.deepEqual(detailPayload.notice.attempts[0].results, []);
    assert.match(detailPayload.notice.attempts[0].requestError, /取消/);
    assert.equal(
      detailPayload.notice.aggregate.requiresReconciliation,
      false,
    );
  });

  it("returns 400 for invalid cancel bodies and 404 for a missing notice", async () => {
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-cancel-invalid");

    for (const body of [
      "{not json",
      JSON.stringify({ version: created.version, title: "附带字段" }),
      JSON.stringify({}),
      JSON.stringify({ version: 0 }),
      JSON.stringify({ version: -1 }),
      JSON.stringify({ version: 1.5 }),
      JSON.stringify({ version: "1" }),
    ]) {
      const response = await callCancel(cookie, created.id, body);
      assert.equal(response.status, 400, body);
      assert.equal(typeof (await response.json()).message, "string");
    }

    const missing = await callCancel(cookie, "does-not-exist", {
      version: 1,
    });
    assert.equal(missing.status, 404);

    const detail = await callDetail(cookie, created.id);
    const payload = await detail.json();
    assert.equal(payload.notice.status, "upcoming");
    assert.equal(payload.notice.version, created.version);
  });

  it("serves edit and cancel without resolving upstream config or fetching", async () => {
    delete process.env.KOMARI_API_ORIGIN;
    delete process.env.KOMARI_API_BEARER_TOKEN;
    const cookie = await loginCookie();
    const created = await createNotice(cookie, "api-edit-local-only");
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("edit/cancel routes must not call upstream");
    };

    try {
      const edited = await callPatch(cookie, created.id, {
        ...maintenanceInput({ title: "本地修改" }),
        version: created.version,
      });
      assert.equal(edited.status, 200);
      const canceled = await callCancel(cookie, created.id, {
        version: created.version + 1,
      });
      assert.equal(canceled.status, 200);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

async function loginCookie() {
  const login = await loginRequest(routes.loginRoute);
  return sessionCookie(login);
}

async function createNotice(cookie, submissionId) {
  const response = await routes.listRoute.POST(
    new NextRequest(`${TEST_ORIGIN}/api/console/announcements`, {
      body: JSON.stringify(maintenanceInput()),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: TEST_ORIGIN,
        "x-request-id": submissionId,
      },
      method: "POST",
    }),
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  return payload.notice;
}

function callPatch(cookie, id, body, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(options.origin === null ? {} : { origin: options.origin ?? TEST_ORIGIN }),
  };

  return routes.detailRoute.PATCH(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}`,
      {
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers,
        method: "PATCH",
      },
    ),
    { params: Promise.resolve({ id }) },
  );
}

function callCancel(cookie, id, body, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(options.origin === null ? {} : { origin: options.origin ?? TEST_ORIGIN }),
  };

  return routes.cancelRoute.POST(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}/cancel`,
      {
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers,
        method: "POST",
      },
    ),
    { params: Promise.resolve({ id }) },
  );
}

function callDetail(cookie, id) {
  return routes.detailRoute.GET(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}`,
      { headers: { cookie } },
    ),
    { params: Promise.resolve({ id }) },
  );
}
