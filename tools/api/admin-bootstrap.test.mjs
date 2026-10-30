import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTypeScriptModule } from "./typescript-modules.mjs";

const builtinImports = {
  "node:crypto": "node:crypto",
  "node:fs": "node:fs",
  "node:path": "node:path",
  "node:sqlite": "node:sqlite",
};

const tmpRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
const tempDirectories = [];
const environmentKeys = [
  "CONSOLE_ADMIN_PASSWORD_HASH",
  "CONSOLE_ADMIN_USERNAME",
  "CONSOLE_DATABASE_PATH",
  "CONSOLE_PUBLIC_ORIGIN",
];
const savedEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);

async function createBootstrapModules(marker = "") {
  const suffix = marker ? `#${marker}` : "";
  const databaseUrl =
    loadTypeScriptModule("src/lib/server/database.ts", builtinImports) + suffix;
  const passwordUrl =
    loadTypeScriptModule("src/lib/server/password.ts", builtinImports) + suffix;
  const adminAccountUrl =
    loadTypeScriptModule("src/lib/server/admin-account.ts", {
      ...builtinImports,
      "./database": databaseUrl,
      "./password": passwordUrl,
    }) + suffix;
  const configUrl =
    loadTypeScriptModule("src/lib/server/auth-config.ts", {
      ...builtinImports,
      "./admin-account": adminAccountUrl,
    }) + suffix;
  const bootstrapUrl =
    loadTypeScriptModule("src/lib/server/auth-bootstrap.ts", {
      ...builtinImports,
      "./admin-account": adminAccountUrl,
      "./auth-config": configUrl,
    }) + suffix;

  return {
    account: await import(adminAccountUrl),
    bootstrap: await import(bootstrapUrl),
    database: await import(databaseUrl),
    password: await import(passwordUrl),
  };
}

const modules = await createBootstrapModules();

async function createDatabasePath() {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tmpRoot, "admin-bootstrap-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "console.sqlite");
}

function configureEnvironment(databasePath, overrides = {}) {
  process.env.CONSOLE_DATABASE_PATH = databasePath;
  process.env.CONSOLE_PUBLIC_ORIGIN = "http://localhost:3000";
  delete process.env.CONSOLE_ADMIN_USERNAME;
  delete process.env.CONSOLE_ADMIN_PASSWORD_HASH;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function captureConsole() {
  const messages = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => messages.push(args.map(String).join(" "));
  console.error = (...args) => errors.push(args.map(String).join(" "));

  return {
    errors,
    messages,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

function extractInitialPassword(text) {
  const match = /初始密码[：:]\s*(\S+)/.exec(text);
  assert.ok(match, "expected the one-time guidance to contain the password");
  return match[1];
}

afterEach(async () => {
  for (const key of environmentKeys) {
    const value = savedEnvironment[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("console authentication bootstrap", () => {
  it("logs the initial password exactly once and never again on restart", async () => {
    const databasePath = await createDatabasePath();
    configureEnvironment(databasePath);
    const capture = captureConsole();

    try {
      await modules.bootstrap.bootstrapConsoleAuthentication();

      assert.equal(capture.messages.length, 1);
      assert.match(capture.messages[0], /用户名[：:]\s*admin/);
      assert.match(capture.messages[0], /只显示一次|仅显示这一次/);
      assert.match(capture.messages[0], /重置/);

      const password = extractInitialPassword(capture.messages[0]);
      const account = modules.account.getConsoleAdminAccount(databasePath);
      assert.equal(
        await modules.password.verifyConsolePassword(
          password,
          account.passwordHash,
        ),
        true,
      );

      capture.messages.length = 0;
      await modules.bootstrap.bootstrapConsoleAuthentication();
      assert.deepEqual(capture.messages, []);
    } finally {
      capture.restore();
    }
  });

  it("ignores legacy administrator environment credentials", async () => {
    const databasePath = await createDatabasePath();
    const legacyPassword = "legacy-environment-password";
    const legacyHash = await modules.password.hashConsolePassword(legacyPassword);
    configureEnvironment(databasePath, {
      CONSOLE_ADMIN_PASSWORD_HASH: legacyHash,
      CONSOLE_ADMIN_USERNAME: "legacy-env-admin",
    });
    const capture = captureConsole();

    try {
      await modules.bootstrap.bootstrapConsoleAuthentication();

      const password = extractInitialPassword(capture.messages[0]);
      assert.notEqual(password, legacyPassword);
      const account = modules.account.getConsoleAdminAccount(databasePath);
      assert.equal(account.username, "admin");
      assert.equal(
        await modules.password.verifyConsolePassword(
          legacyPassword,
          account.passwordHash,
        ),
        false,
      );
      assert.equal(
        await modules.password.verifyConsolePassword(
          password,
          account.passwordHash,
        ),
        true,
      );
    } finally {
      capture.restore();
    }
  });

  it("does not reprint a password committed before the process exited", async () => {
    const databasePath = await createDatabasePath();
    configureEnvironment(databasePath);
    const commit = await modules.account.initializeConsoleAdmin(databasePath);
    assert.equal(commit.initialized, true);

    const capture = captureConsole();

    try {
      await modules.bootstrap.bootstrapConsoleAuthentication();
      assert.deepEqual(capture.messages, []);
      assert.equal(capture.errors.length, 0);
    } finally {
      capture.restore();
    }
  });

  it("rejects a malformed stored hash without printing or overwriting credentials", async () => {
    const databasePath = await createDatabasePath();
    configureEnvironment(databasePath);
    const malformedHash = "scrypt$malformed";
    const database = modules.database.openConsoleDatabase(databasePath);
    database
      .prepare(
        `INSERT INTO console_admin_account
          (id, username, password_hash, is_random_initial_password,
           reminder_dismissed, created_at, updated_at)
         VALUES (1, 'corrupted-admin', ?, 0, 1, 1, 1)`,
      )
      .run(malformedHash);
    database.close();
    const capture = captureConsole();

    try {
      await assert.rejects(
        modules.bootstrap.bootstrapConsoleAuthentication(),
        (error) => {
          assert.equal(error.message, "控制台管理员凭据初始化失败。");
          assert.equal(error.message.includes(malformedHash), false);
          assert.equal(error.message.includes("corrupted-admin"), false);
          return true;
        },
      );
      assert.deepEqual(capture.messages, []);

      const check = modules.database.openConsoleDatabase(databasePath);
      const row = check
        .prepare("SELECT username, password_hash FROM console_admin_account")
        .get();
      check.close();
      assert.deepEqual({ ...row }, {
        password_hash: malformedHash,
        username: "corrupted-admin",
      });
    } finally {
      capture.restore();
    }
  });

  it("fails closed without creating a database when required environment is missing", async () => {
    const databasePath = await createDatabasePath();
    configureEnvironment(databasePath, { CONSOLE_PUBLIC_ORIGIN: undefined });
    const capture = captureConsole();

    try {
      await assert.rejects(
        modules.bootstrap.bootstrapConsoleAuthentication(),
        (error) => error.message === "控制台管理员凭据初始化失败。",
      );
      assert.equal(existsSync(databasePath), false);
      assert.deepEqual(capture.messages, []);
    } finally {
      capture.restore();
    }
  });

  it("keeps the plaintext initial password out of database files", async () => {
    const databasePath = await createDatabasePath();
    configureEnvironment(databasePath);
    const capture = captureConsole();
    let password;

    try {
      await modules.bootstrap.bootstrapConsoleAuthentication();
      password = extractInitialPassword(capture.messages[0]);
    } finally {
      capture.restore();
    }

    for (const file of [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ].filter((candidate) => existsSync(candidate))) {
      const bytes = await readFile(file);
      assert.equal(
        bytes.includes(Buffer.from(password, "utf8")),
        false,
        `plaintext password persisted in ${path.basename(file)}`,
      );
    }
  });
});
