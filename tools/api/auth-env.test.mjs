import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  TEST_USERNAME,
  clearAuthEnv,
  configureAuthEnv,
  createAuthModuleUrls,
  createPasswordHash,
  createTestDatabasePath,
  loadAuthRoutes,
  loginRequest,
  sessionGet,
  writeConsoleAdminAccount,
} from "./auth-fixtures.mjs";

afterEach(() => {
  clearAuthEnv();
});

describe("console authentication environment", () => {
  it("documents database-backed credentials without manual hash setup", () => {
    const envExample = readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf8",
    );
    const readme = readFileSync(
      new URL("../../README.md", import.meta.url),
      "utf8",
    );

    assert.equal(envExample.includes("CONSOLE_ADMIN_USERNAME"), false);
    assert.equal(envExample.includes("CONSOLE_ADMIN_PASSWORD_HASH"), false);
    assert.ok(envExample.includes("CONSOLE_PUBLIC_ORIGIN"));
    assert.ok(envExample.includes("CONSOLE_DATABASE_PATH"));
    assert.match(
      readme,
      /不读取 `CONSOLE_ADMIN_USERNAME` 和 `CONSOLE_ADMIN_PASSWORD_HASH`/,
    );
    assert.equal(readme.includes("生成密码哈希"), false);
    assert.equal(readme.includes("scrypt$<"), false);
    assert.match(readme, /初始密码/);
  });

  it("exposes only credential-independent configuration to bootstrap callers", async () => {
    const temp = await createTestDatabasePath();
    await configureAuthEnv({ databasePath: temp.databasePath });
    const { configUrl } = createAuthModuleUrls();
    const config = await import(configUrl);

    assert.deepEqual(config.getConsoleAuthEnvironment(), {
      databasePath: temp.databasePath,
      publicOrigin: TEST_ORIGIN,
    });
    assert.equal(config.getConsoleDatabasePath(), temp.databasePath);

    process.env.CONSOLE_PUBLIC_ORIGIN = "https://console.example.com/path";
    assert.throws(
      () => config.getConsoleAuthEnvironment(),
      (error) => error.message === "控制台认证配置不可用。",
    );

    process.env.CONSOLE_PUBLIC_ORIGIN = TEST_ORIGIN;
    process.env.CONSOLE_DATABASE_PATH = "relative.sqlite";
    assert.throws(
      () => config.getConsoleDatabasePath(),
      (error) => error.message === "控制台认证配置不可用。",
    );
  });

  it("ignores legacy administrator credentials from the environment", async () => {
    const temp = await createTestDatabasePath();
    await configureAuthEnv({ databasePath: temp.databasePath });
    const legacyPassword = "legacy-password-from-environment";
    process.env.CONSOLE_ADMIN_USERNAME = "legacy-env-admin";
    process.env.CONSOLE_ADMIN_PASSWORD_HASH = createPasswordHash(legacyPassword);
    const routes = await loadAuthRoutes();

    const databaseCredential = await loginRequest(routes.loginRoute);
    assert.equal(databaseCredential.status, 200);
    assert.deepEqual(await databaseCredential.json(), {
      username: TEST_USERNAME,
    });

    const legacyCredential = await loginRequest(routes.loginRoute, {
      password: legacyPassword,
      username: "legacy-env-admin",
    });
    assert.equal(legacyCredential.status, 401);
    assert.deepEqual(await legacyCredential.json(), {
      message: "用户名或密码错误。",
    });
  });

  it("fails closed with the sanitized config error when the stored hash is malformed", async () => {
    const temp = await createTestDatabasePath();
    await configureAuthEnv({ databasePath: temp.databasePath });
    const malformedHash = "scrypt$malformed";
    await writeConsoleAdminAccount({
      databasePath: temp.databasePath,
      passwordHash: malformedHash,
    });
    const routes = await loadAuthRoutes();

    const response = await loginRequest(routes.loginRoute);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body, { message: "控制台认证配置不可用。" });
    assert.equal(JSON.stringify(body).includes(malformedHash), false);

    const session = await sessionGet(routes.sessionRoute, null);
    assert.equal(session.status, 500);
    assert.deepEqual(await session.json(), {
      message: "控制台认证配置不可用。",
    });
  });

  it("does not lazily initialize a missing account at the route seam", async () => {
    const temp = await createTestDatabasePath();
    process.env.CONSOLE_PUBLIC_ORIGIN = TEST_ORIGIN;
    process.env.CONSOLE_DATABASE_PATH = temp.databasePath;
    const routes = await loadAuthRoutes();

    const response = await loginRequest(routes.loginRoute);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "控制台认证配置不可用。",
    });

    const { databaseUrl } = createAuthModuleUrls();
    const { openConsoleDatabase } = await import(databaseUrl);
    const database = openConsoleDatabase(temp.databasePath);
    const row = database
      .prepare("SELECT COUNT(*) AS count FROM console_admin_account")
      .get();
    assert.equal(Number(row.count), 0);
  });

  it("rejects malformed public origins and relative database paths", async () => {
    const temp = await createTestDatabasePath();
    process.env.CONSOLE_PUBLIC_ORIGIN = "https://console.example.com/path";
    process.env.CONSOLE_DATABASE_PATH = temp.databasePath;
    let routes = await loadAuthRoutes();
    assert.equal((await loginRequest(routes.loginRoute)).status, 500);

    process.env.CONSOLE_PUBLIC_ORIGIN = TEST_ORIGIN;
    process.env.CONSOLE_DATABASE_PATH = "relative.sqlite";
    routes = await loadAuthRoutes();
    assert.equal((await loginRequest(routes.loginRoute)).status, 500);

    process.env.CONSOLE_PUBLIC_ORIGIN = "http://console.example.com";
    process.env.CONSOLE_DATABASE_PATH = temp.databasePath;
    routes = await loadAuthRoutes();
    const insecureOrigin = await loginRequest(routes.loginRoute);
    assert.equal(insecureOrigin.status, 500);
    assert.deepEqual(await insecureOrigin.json(), {
      message: "控制台认证配置不可用。",
    });
  });

  it("authenticates with the exact seeded database password bytes", async () => {
    const password = "  correct horse\\battery staple  ";
    const temp = await createTestDatabasePath();
    await configureAuthEnv({
      databasePath: temp.databasePath,
      passwordHash: createPasswordHash(password),
    });
    const routes = await loadAuthRoutes();

    const response = await loginRequest(routes.loginRoute, { password });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { username: TEST_USERNAME });
    assert.equal(TEST_PASSWORD.length > 0, true);
  });
});
