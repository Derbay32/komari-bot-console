import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  NextRequest,
  TEST_ORIGIN,
  clearAuthEnv,
  configureAuthEnv,
  createTestDatabasePath,
  loadAuthRoutes,
  loadProxyRoute,
  loginRequest,
  proxyContext,
  sessionCookie,
  sessionGet,
} from "./auth-fixtures.mjs";
import { loadTypeScriptModule } from "./typescript-modules.mjs";

const clientUrl = loadTypeScriptModule("src/lib/http/client.ts");
const { ApiError, apiFetch } = await import(clientUrl);

const originalFetch = globalThis.fetch;
let authRoutes;
let navigations;
let proxyRoute;
let upstreamHandler;
let upstreamRequests;

beforeEach(async () => {
  navigations = [];
  upstreamRequests = [];
  upstreamHandler = () =>
    new Response(JSON.stringify({ items: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  globalThis.window = {
    location: {
      pathname: "/knowledge",
      replace(url) {
        navigations.push(url);
      },
    },
  };

  const temp = await createTestDatabasePath();
  configureAuthEnv({ databasePath: temp.databasePath });
  authRoutes = await loadAuthRoutes();
  proxyRoute = await loadProxyRoute();
  globalThis.fetch = routeThroughProxy;
});

afterEach(() => {
  clearAuthEnv();
  delete globalThis.window;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAuthEnv();
  delete globalThis.window;
});

describe("protected API client behavior", () => {
  it("routes the local unauthenticated marker to login while preserving ApiError", async () => {
    await assert.rejects(apiFetch("/api/v2/komari-knowledge/knowledge"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.message, "未登录或会话已过期。");
      assert.equal(
        Reflect.get(error.payload, "code"),
        "CONSOLE_UNAUTHENTICATED",
      );
      return true;
    });

    assert.deepEqual(navigations, ["/login"]);
  });

  it("keeps an upstream 401 as ApiError when the console session stays valid", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    upstreamHandler = () =>
      new Response(JSON.stringify({ detail: "backend token expired" }), {
        headers: { "content-type": "application/json" },
        status: 401,
      });

    await assert.rejects(
      apiFetch("/api/v2/komari-knowledge/knowledge", {
        headers: { cookie },
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.message, "backend token expired");
        assert.equal(Reflect.get(error.payload, "code"), undefined);
        return true;
      },
    );

    assert.deepEqual(navigations, []);
    assert.equal((await sessionGet(authRoutes.sessionRoute, cookie)).status, 200);
  });

  it("does not redirect non-401 failures or loop on the login page", async () => {
    upstreamHandler = () =>
      new Response(JSON.stringify({ detail: "upstream unavailable" }), {
        headers: { "content-type": "application/json" },
        status: 503,
      });
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);

    await assert.rejects(
      apiFetch("/api/v2/komari-knowledge/knowledge", {
        headers: { cookie },
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 503);
        return true;
      },
    );
    assert.deepEqual(navigations, []);

    globalThis.window.location.pathname = "/login";
    await assert.rejects(apiFetch("/api/v2/komari-knowledge/knowledge"));
    assert.deepEqual(navigations, []);
  });
});

function routeThroughProxy(input, init = {}) {
  const url = new URL(String(input), TEST_ORIGIN);

  if (url.origin === TEST_ORIGIN && url.pathname.startsWith("/api/proxy/")) {
    const segments = url.pathname
      .slice("/api/proxy/".length)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
    const method = init.method ?? "GET";
    const request = new NextRequest(url, {
      body: init.body,
      headers: init.headers,
      method,
    });

    return proxyRoute[method](request, proxyContext(segments));
  }

  upstreamRequests.push(String(input));
  return Promise.resolve(upstreamHandler(input, init));
}
