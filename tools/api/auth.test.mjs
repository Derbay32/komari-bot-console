import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  TEST_SECURE_ORIGIN,
  TEST_USERNAME,
  clearAuthEnv,
  configureAuthEnv,
  createTestDatabasePath,
  loadAuthRoutes,
  loginRequest,
  logoutRequest,
  sessionCookie,
  sessionGet,
  sessionToken,
} from "./auth-fixtures.mjs";

const originalDateNow = Date.now;
const originalFetch = globalThis.fetch;
let authRoutes;

beforeEach(async () => {
  globalThis.fetch = async () => {
    throw new Error("Authentication tests must not call upstream fetch");
  };

  const temp = await createTestDatabasePath();
  configureAuthEnv({ databasePath: temp.databasePath });
  authRoutes = await loadAuthRoutes();
});

afterEach(() => {
  clearAuthEnv();
  Date.now = originalDateNow;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAuthEnv();
});

describe("console authentication", () => {
  it("logs in with valid credentials and authorizes protected reads", async () => {
    const response = await loginRequest(authRoutes.loginRoute);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { username: TEST_USERNAME });

    const cookie = sessionCookie(response);
    const session = await sessionGet(authRoutes.sessionRoute, cookie);

    assert.equal(session.status, 200);
    assert.equal(session.headers.get("cache-control"), "no-store");
    assert.deepEqual(await session.json(), { username: TEST_USERNAME });

    const authorization = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge`, {
        headers: { cookie },
      }),
    );

    assert.equal(authorization.authorized, true);
    assert.equal(authorization.username, TEST_USERNAME);
  });

  it("rejects wrong credentials with a clear generic error", async () => {
    const wrongPassword = await loginRequest(authRoutes.loginRoute, {
      password: "not-the-password",
    });
    const wrongUsername = await loginRequest(authRoutes.loginRoute, {
      username: "other-admin",
    });

    for (const response of [wrongPassword, wrongUsername]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      const body = await response.json();
      assert.deepEqual(body, { message: "用户名或密码错误。" });
      assert.equal("code" in body, false);
    }
  });

  it("rejects malformed login input without leaking configuration", async () => {
    const malformed = await loginRequest(authRoutes.loginRoute, {
      body: "{not-json",
    });
    const oversized = await loginRequest(authRoutes.loginRoute, {
      body: JSON.stringify({ password: "x".repeat(5000), username: TEST_USERNAME }),
    });
    const longPassword = await loginRequest(authRoutes.loginRoute, {
      password: "x".repeat(1025),
    });
    const longUsername = await loginRequest(authRoutes.loginRoute, {
      username: "u".repeat(129),
    });

    for (const response of [malformed, oversized, longPassword, longUsername]) {
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { message: "用户名或密码错误。" });
    }
  });

  it("fails closed when required configuration is malformed", async () => {
    process.env.CONSOLE_ADMIN_USERNAME = "leaky-admin-name";
    process.env.CONSOLE_ADMIN_PASSWORD_HASH = "not-a-valid-hash";

    const response = await loginRequest(authRoutes.loginRoute, {
      username: "leaky-admin-name",
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { message: "控制台认证配置不可用。" });
    assert.doesNotMatch(JSON.stringify(body), /leaky-admin-name|not-a-valid-hash/);

    const session = await sessionGet(authRoutes.sessionRoute, null);
    assert.equal(session.status, 500);
    assert.deepEqual(await session.json(), { message: "控制台认证配置不可用。" });

    const authorization = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge`),
    );
    assert.equal(authorization.authorized, false);
    assert.equal(authorization.response.status, 500);
  });

  it("requires the configured origin for login and unsafe authorized requests", async () => {
    const missingOrigin = await loginRequest(authRoutes.loginRoute, {
      origin: null,
    });
    const wrongOrigin = await loginRequest(authRoutes.loginRoute, {
      origin: "https://attacker.example",
    });

    for (const response of [missingOrigin, wrongOrigin]) {
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.deepEqual(await response.json(), { message: "请求来源校验失败。" });
    }

    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    const unsafeWithoutOrigin = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge/7`, {
        headers: { cookie },
        method: "POST",
      }),
    );
    const unsafeWithOrigin = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge/7`, {
        headers: { cookie, origin: TEST_ORIGIN },
        method: "POST",
      }),
    );
    const safeWithoutOrigin = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge/7`, {
        headers: { cookie },
      }),
    );

    assert.equal(unsafeWithoutOrigin.authorized, false);
    assert.equal(unsafeWithoutOrigin.response.status, 403);
    assert.equal(unsafeWithOrigin.authorized, true);
    assert.equal(unsafeWithOrigin.username, TEST_USERNAME);
    assert.equal(safeWithoutOrigin.authorized, true);
  });

  it("sets a token-only hardened cookie and no-store responses", async () => {
    configureAuthEnv({
      databasePath: process.env.CONSOLE_DATABASE_PATH,
      origin: TEST_SECURE_ORIGIN,
    });
    const response = await loginRequest(authRoutes.loginRoute, {
      origin: TEST_SECURE_ORIGIN,
    });
    const setCookie = response.headers.getSetCookie()[0];
    const token = sessionToken(response);

    assert.equal(response.status, 200);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=strict/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=28800/);
    assert.match(setCookie, /Secure/);
    assert.doesNotMatch(setCookie, /Domain=/);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(setCookie.includes(TEST_PASSWORD_HASH), false);
    assert.equal(JSON.stringify(await response.json()).includes(token), false);

    configureAuthEnv({
      databasePath: process.env.CONSOLE_DATABASE_PATH,
      origin: TEST_ORIGIN,
    });
    const localLogin = await loginRequest(authRoutes.loginRoute);
    assert.doesNotMatch(localLogin.headers.getSetCookie()[0], /Secure/);

    const unauthenticated = await sessionGet(authRoutes.sessionRoute, null);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
  });

  it("rejects expired sessions using the persisted absolute expiry", async () => {
    let now = 1_700_000_000_000;
    Date.now = () => now;

    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);

    assert.equal((await sessionGet(authRoutes.sessionRoute, cookie)).status, 200);

    now += 8 * 60 * 60 * 1000 - 1;
    assert.equal((await sessionGet(authRoutes.sessionRoute, cookie)).status, 200);

    now += 2;
    const expired = await sessionGet(authRoutes.sessionRoute, cookie);

    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), {
      code: "CONSOLE_UNAUTHENTICATED",
      message: "未登录或会话已过期。",
    });

    const authorization = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge`, {
        headers: { cookie },
      }),
    );
    assert.equal(authorization.authorized, false);
    assert.equal(authorization.response.status, 401);
  });

  it("revokes the persisted session on logout and rejects replay", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    const crossOriginLogout = await logoutRequest(authRoutes.logoutRoute, cookie, {
      origin: "https://attacker.example",
    });

    assert.equal(crossOriginLogout.status, 403);
    assert.equal((await sessionGet(authRoutes.sessionRoute, cookie)).status, 200);

    const logout = await logoutRequest(authRoutes.logoutRoute, cookie);
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true });
    assert.match(logout.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal(logout.headers.get("cache-control"), "no-store");

    const replay = await sessionGet(authRoutes.sessionRoute, cookie);
    assert.equal(replay.status, 401);
    assert.deepEqual(await replay.json(), {
      code: "CONSOLE_UNAUTHENTICATED",
      message: "未登录或会话已过期。",
    });

    const authorization = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge`, {
        headers: { cookie },
      }),
    );
    assert.equal(authorization.authorized, false);
    assert.equal((await logoutRequest(authRoutes.logoutRoute, cookie)).status, 401);
  });

  it("rotates an incoming session on a new login", async () => {
    const firstLogin = await loginRequest(authRoutes.loginRoute);
    const firstCookie = sessionCookie(firstLogin);
    const secondLogin = await loginRequest(authRoutes.loginRoute, {
      body: JSON.stringify({
        password: TEST_PASSWORD,
        username: TEST_USERNAME,
      }),
      cookie: firstCookie,
    });
    const secondCookie = sessionCookie(secondLogin);

    assert.notEqual(firstCookie, secondCookie);
    assert.equal((await sessionGet(authRoutes.sessionRoute, firstCookie)).status, 401);
    assert.equal((await sessionGet(authRoutes.sessionRoute, secondCookie)).status, 200);
  });

  it("persists sessions across a fresh auth module instance", async () => {
    const login = await loginRequest(authRoutes.loginRoute);
    const cookie = sessionCookie(login);
    const freshRoutes = await loadAuthRoutes({ marker: "fresh-process" });

    const session = await sessionGet(freshRoutes.sessionRoute, cookie);
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), { username: TEST_USERNAME });

    const authorization = await freshRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/v2/komari-knowledge/knowledge`, {
        headers: { cookie },
      }),
    );
    assert.equal(authorization.authorized, true);
  });

  it("throttles failed logins globally for sixty seconds", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await loginRequest(authRoutes.loginRoute, {
        password: "wrong-password",
      });
      assert.equal(response.status, 401);
    }

    const blocked = await loginRequest(authRoutes.loginRoute, {
      password: "wrong-password",
    });
    const retryAfter = Number(blocked.headers.get("retry-after"));
    const blockedWithCorrectPassword = await loginRequest(authRoutes.loginRoute);

    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("cache-control"), "no-store");
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    assert.equal(blockedWithCorrectPassword.status, 429);

    const freshRoutes = await loadAuthRoutes({ marker: "fresh-throttle" });
    const freshBlocked = await loginRequest(freshRoutes.loginRoute, {
      password: "wrong-password",
    });
    assert.equal(freshBlocked.status, 429);

    const originalNow = Date.now();
    Date.now = () => originalNow + 61_000;
    const afterWindow = await loginRequest(authRoutes.loginRoute, {
      password: "wrong-password",
    });
    assert.equal(afterWindow.status, 401);
  });

  it("bounds concurrent failed attempts with the shared window", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        loginRequest(authRoutes.loginRoute, { password: "wrong-password" }),
      ),
    );
    const statuses = attempts.map((response) => response.status);

    assert.equal(statuses.filter((status) => status === 401).length, 10);
    assert.equal(statuses.filter((status) => status === 429).length, 10);
    assert.equal((await loginRequest(authRoutes.loginRoute)).status, 429);
  });
});
