import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scryptSync } from "node:crypto";

import {
  TEST_USERNAME,
  clearAuthEnv,
  configureAuthEnv,
  createTestDatabasePath,
  loadAuthRoutes,
  loginRequest,
} from "./auth-fixtures.mjs";

const PASSWORD = "  correct horse\\battery staple  ";
const SALT = "00112233445566778899aabbccddeeff";
const RAW_HASH = createHash(PASSWORD);
const DOTENV_HASH = RAW_HASH.replaceAll("$", "\\$");

afterEach(() => {
  clearAuthEnv();
});

describe("console authentication environment docs", () => {
  it("documents dotenv escaping and byte-preserving hash generation", () => {
    const envExample = readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf8",
    );
    const readme = readFileSync(
      new URL("../../README.md", import.meta.url),
      "utf8",
    );

    assert.ok(
      envExample.includes(
        "CONSOLE_ADMIN_PASSWORD_HASH=scrypt\\$<32位小写十六进制盐>\\$<128位小写十六进制摘要>",
      ),
    );
    assert.ok(readme.includes("\\$"));
    assert.ok(readme.includes("进程环境变量"));
    assert.match(readme, /IFS= read -r/);
    assert.match(readme, /printf '%s'/);
    assert.equal(readme.includes("trimEnd"), false);
  });

  it("round-trips the escaped value through @next/env and logs in with exact password bytes", async () => {
    delete process.env.CONSOLE_ADMIN_PASSWORD_HASH;
    const nextEnv = await import("@next/env");
    const { processEnv } = nextEnv.default ?? nextEnv;
    const envFile = {
      contents: `CONSOLE_ADMIN_PASSWORD_HASH=${DOTENV_HASH}\n`,
      path: ".env.synthetic",
    };

    processEnv([envFile], "/synthetic", { error() {} }, true);
    const loadedHash = envFile.env?.CONSOLE_ADMIN_PASSWORD_HASH;

    assert.equal(loadedHash, RAW_HASH);
    assert.notEqual(loadedHash, "scrypt");

    const temp = await createTestDatabasePath();
    configureAuthEnv({
      databasePath: temp.databasePath,
      passwordHash: loadedHash,
    });
    const routes = await loadAuthRoutes();
    const response = await loginRequest(routes.loginRoute, {
      password: PASSWORD,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { username: TEST_USERNAME });
  });
});

function createHash(password) {
  const digest = scryptSync(
    Buffer.from(password, "utf8"),
    Buffer.from(SALT, "hex"),
    64,
    { N: 16384, p: 1, r: 8 },
  ).toString("hex");

  return `scrypt$${SALT}$${digest}`;
}
