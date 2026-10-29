import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NextRequest,
  TEST_BACKEND_TOKEN,
  TEST_ORIGIN,
  clearAuthEnv,
  configureAuthEnv,
  createTestDatabasePath,
  failingRuntimeConfigSource,
  loadAuthRoutes,
  loadProxyRoute,
  loginRequest,
  proxyContext,
  proxyRequestUrl,
  sessionCookie,
} from "./auth-fixtures.mjs";

const originalDateNow = Date.now;
const originalFetch = globalThis.fetch;
let authRoutes;
let proxyRoute;
let upstreamHandler;
let upstreamRequests;

beforeEach(async () => {
  upstreamRequests = [];
  upstreamHandler = () =>
    new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  globalThis.fetch = async (input, init = {}) => {
    upstreamRequests.push({
      body: init.body,
      headers: new Headers(init.headers),
      method: init.method,
      url: String(input),
    });
    return upstreamHandler(input, init);
  };

  const temp = await createTestDatabasePath();
  configureAuthEnv({ databasePath: temp.databasePath });
  authRoutes = await loadAuthRoutes();
  proxyRoute = await loadProxyRoute();
});

afterEach(() => {
  clearAuthEnv();
  Date.now = originalDateNow;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAuthEnv();
});

describe("console proxy authentication", () => {
  it("rejects unauthenticated requests for every exported method before upstream access", async () => {
    const statuses = {};

    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await callProxy(proxyRoute, method);
      statuses[method] = response.status;
      assert.ok([401, 403].includes(response.status), `${method} was not denied`);
      assert.equal(
        response.headers.get("cache-control"),
        "no-store, private",
      );
    }

    assert.equal(upstreamRequests.length, 0);
    assert.deepEqual(statuses, {
      DELETE: 403,
      GET: 401,
      OPTIONS: 401,
      PATCH: 403,
      POST: 403,
      PUT: 403,
    });

    const unauthenticated = await callProxy(proxyRoute, "GET");
    assert.deepEqual(await unauthenticated.json(), {
      code: "CONSOLE_UNAUTHENTICATED",
      message: "未登录或会话已过期。",
    });
    assert.equal(upstreamRequests.length, 0);
  });

  it("forwards authorized reads without the console cookie and strips upstream cookies", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    upstreamHandler = () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "cache-control": "public, max-age=300",
          "content-type": "application/json",
          "set-cookie": "upstream_session=should-not-leak; HttpOnly",
        },
        status: 200,
      });

    const response = await callProxy(proxyRoute, "GET", { cookie });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(upstreamRequests.length, 1);

    const upstream = upstreamRequests[0];
    assert.equal(upstream.method, "GET");
    assert.equal(upstream.headers.get("cookie"), null);
    assert.equal(
      upstream.headers.get("authorization"),
      `Bearer ${TEST_BACKEND_TOKEN}`,
    );
    assert.equal(
      upstream.url,
      "http://backend.test/api/v2/komari-knowledge/knowledge",
    );
  });

  it("requires the exact origin for authorized proxy mutations", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    const body = JSON.stringify({ reason: "刷屏" });
    const missingOrigin = await callProxy(proxyRoute, "POST", { body, cookie });
    const wrongOrigin = await callProxy(proxyRoute, "POST", {
      body,
      cookie,
      origin: "https://attacker.example",
    });

    assert.equal(missingOrigin.status, 403);
    assert.equal(wrongOrigin.status, 403);
    assert.equal(upstreamRequests.length, 0);

    upstreamHandler = () =>
      new Response(JSON.stringify({ action: "created" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    const accepted = await callProxy(proxyRoute, "POST", {
      body,
      cookie,
      origin: TEST_ORIGIN,
    });

    assert.equal(accepted.status, 200);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].method, "POST");
    assert.equal(
      new TextDecoder().decode(upstreamRequests[0].body),
      body,
    );
    assert.equal(
      upstreamRequests[0].headers.get("x-komari-change-reason"),
      auditHeaderValue(),
    );
  });

  it("fails closed before upstream access when auth configuration is invalid", async () => {
    clearAuthEnv();

    const response = await callProxy(proxyRoute, "GET");

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "控制台认证配置不可用。",
    });
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    assert.equal(upstreamRequests.length, 0);
  });

  it("does not leak internal runtime configuration or fetch errors", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    const failingConfigProxy = await loadProxyRoute({
      marker: "failing-runtime-config",
      runtimeConfig: failingRuntimeConfigSource(
        `cannot read secret ${TEST_BACKEND_TOKEN} at /private/path`,
      ),
    });
    const configFailure = await callProxy(failingConfigProxy, "GET", { cookie });
    const configBody = await configFailure.text();

    assert.equal(configFailure.status, 502);
    assert.equal(configBody.includes(TEST_BACKEND_TOKEN), false);
    assert.equal(configBody.includes("/private/path"), false);
    assert.equal(upstreamRequests.length, 0);

    upstreamHandler = () => {
      throw new Error(`connect failed with ${TEST_BACKEND_TOKEN}`);
    };
    const fetchFailure = await callProxy(proxyRoute, "GET", { cookie });
    const fetchBody = await fetchFailure.text();

    assert.equal(fetchFailure.status, 502);
    assert.equal(fetchBody.includes(TEST_BACKEND_TOKEN), false);
    assert.deepEqual(JSON.parse(fetchBody), { message: "上游服务请求失败。" });
  });

  it("keeps slash-leading catch-all segments on the configured upstream origin", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);

    const response = await callProxy(proxyRoute, "GET", {
      cookie,
      segments: ["/attacker.invalid", "path"],
    });

    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.length, 1);
    const upstreamUrl = new URL(upstreamRequests[0].url);
    assert.equal(upstreamUrl.origin, "http://backend.test");
    assert.equal(upstreamUrl.pathname, "//attacker.invalid/path");
  });

  it("rejects invalid or expired session cookies without upstream access", async () => {
    let now = 1_700_000_000_000;
    Date.now = () => now;

    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);

    const invalid = await callProxy(proxyRoute, "GET", {
      cookie: "komari_console_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    assert.equal(invalid.status, 401);
    assert.equal(upstreamRequests.length, 0);

    now += 8 * 60 * 60 * 1000;
    const expired = await callProxy(proxyRoute, "GET", { cookie });
    assert.equal(expired.status, 401);
    assert.equal(upstreamRequests.length, 0);
  });
});

function auditHeaderValue() {
  return String.fromCharCode(...Buffer.from("刷屏", "utf8"));
}

function callProxy(route, method, { body, cookie, origin, path, segments } = {}) {
  const headers = {};

  if (cookie) {
    headers.cookie = cookie;
  }

  if (origin) {
    headers.origin = origin;
  }

  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["x-komari-change-reason"] = auditHeaderValue();
  }

  return route[method](
    new NextRequest(proxyRequestUrl(path), {
      body,
      headers,
      method,
    }),
    proxyContext(segments),
  );
}
