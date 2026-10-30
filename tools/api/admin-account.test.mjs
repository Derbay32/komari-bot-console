import { afterEach, describe, it } from "node:test";
import { spawn } from "node:child_process";
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

async function createAccountModules(marker = "") {
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

  return {
    account: await import(adminAccountUrl),
    database: await import(databaseUrl),
    password: await import(passwordUrl),
  };
}

const modules = await createAccountModules();

async function createDatabasePath() {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tmpRoot, "admin-account-test-"));
  tempDirectories.push(directory);
  return path.join(directory, "console.sqlite");
}

function insertAccount(
  databasePath,
  {
    createdAt = 1_700_000_000_000,
    isRandomInitialPassword = 0,
    passwordHash = null,
    reminderDismissed = 1,
    updatedAt = createdAt,
    username = "legacy-owner",
  } = {},
) {
  const database = modules.database.openConsoleDatabase(databasePath);
  database
    .prepare(
      `INSERT INTO console_admin_account
        (id, username, password_hash, is_random_initial_password,
         reminder_dismissed, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      username,
      passwordHash,
      isRandomInitialPassword,
      reminderDismissed,
      createdAt,
      updatedAt,
    );
  return database;
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("console admin account initialization", () => {
  it("initializes a missing account with an admin username and random password", async () => {
    const databasePath = await createDatabasePath();
    const result = await modules.account.initializeConsoleAdmin(databasePath);

    assert.equal(result.initialized, true);
    assert.equal(result.username, "admin");
    assert.match(result.password, /^[A-Za-z0-9_-]{32}$/);

    const account = modules.account.getConsoleAdminAccount(databasePath);
    assert.ok(account);
    assert.equal(account.username, "admin");
    assert.notEqual(account.passwordHash, result.password);
    assert.equal(account.isRandomInitialPassword, true);
    assert.equal(account.reminderDismissed, false);
    assert.equal(Number.isSafeInteger(account.createdAt), true);
    assert.equal(Number.isSafeInteger(account.updatedAt), true);
    assert.equal(
      await modules.password.verifyConsolePassword(
        result.password,
        account.passwordHash,
      ),
      true,
    );
  });

  it("treats a null or empty password as missing and resets the username to admin", async () => {
    for (const missingHash of [null, ""]) {
      const databasePath = await createDatabasePath();
      const database = insertAccount(databasePath, {
        createdAt: 1_600_000_000_000,
        isRandomInitialPassword: 0,
        passwordHash: missingHash,
        reminderDismissed: 1,
        updatedAt: 1_600_000_000_000,
        username: "legacy-owner",
      });
      assert.equal(
        modules.account.getConsoleAdminAccount(databasePath),
        null,
      );

      const result = await modules.account.initializeConsoleAdmin(databasePath);
      database.close();

      assert.equal(result.initialized, true);
      assert.equal(result.username, "admin");
      const account = modules.account.getConsoleAdminAccount(databasePath);
      assert.equal(account.username, "admin");
      assert.equal(account.isRandomInitialPassword, true);
      assert.equal(account.reminderDismissed, false);
      assert.equal(account.createdAt, 1_600_000_000_000);
      assert.ok(account.updatedAt >= account.createdAt);
      assert.equal(
        await modules.password.verifyConsolePassword(
          result.password,
          account.passwordHash,
        ),
        true,
      );
    }
  });

  it("preserves an existing valid credential without returning a password", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword("existing-password");
    const createdAt = 1_650_000_000_000;
    insertAccount(databasePath, {
      createdAt,
      isRandomInitialPassword: 1,
      passwordHash: existingHash,
      reminderDismissed: 0,
      updatedAt: createdAt + 5000,
      username: "kept-admin",
    });

    const result = await modules.account.initializeConsoleAdmin(databasePath);
    const account = modules.account.getConsoleAdminAccount(databasePath);

    assert.deepEqual(result, { initialized: false });
    assert.equal(account.username, "kept-admin");
    assert.equal(account.passwordHash, existingHash);
    assert.equal(account.isRandomInitialPassword, true);
    assert.equal(account.reminderDismissed, false);
    assert.equal(account.createdAt, createdAt);
    assert.equal(account.updatedAt, createdAt + 5000);
  });

  it("fails closed on a malformed nonempty hash without overwriting it", async () => {
    const databasePath = await createDatabasePath();
    const malformedHash = "scrypt$not-a-real-hash";
    insertAccount(databasePath, {
      passwordHash: malformedHash,
      username: "corrupted-admin",
    });

    await assert.rejects(
      modules.account.initializeConsoleAdmin(databasePath),
      (error) => {
        assert.equal(
          error.message,
          modules.account.CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE,
        );
        assert.equal(error.message.includes(malformedHash), false);
        assert.equal(error.message.includes("corrupted-admin"), false);
        return true;
      },
    );
    assert.throws(
      () => modules.account.getConsoleAdminAccount(databasePath),
      (error) =>
        error.message ===
        modules.account.CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE,
    );

    const database = modules.database.openConsoleDatabase(databasePath);
    const row = database
      .prepare("SELECT username, password_hash FROM console_admin_account")
      .get();
    database.close();
    assert.deepEqual({ ...row }, {
      password_hash: malformedHash,
      username: "corrupted-admin",
    });
  });

  it("does not treat a malformed username with a valid password as a reset", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword("existing-password");
    insertAccount(databasePath, {
      passwordHash: existingHash,
      username: "",
    });

    await assert.rejects(
      modules.account.initializeConsoleAdmin(databasePath),
      (error) =>
        error.message ===
        modules.account.CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE,
    );
    assert.throws(
      () => modules.account.getConsoleAdminAccount(databasePath),
      (error) =>
        error.message ===
        modules.account.CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE,
    );

    const database = modules.database.openConsoleDatabase(databasePath);
    const row = database
      .prepare("SELECT username, password_hash FROM console_admin_account")
      .get();
    database.close();
    assert.deepEqual({ ...row }, {
      password_hash: existingHash,
      username: "",
    });
  });

  it("allows exactly one of two concurrent initializers to commit", async () => {
    const databasePath = await createDatabasePath();
    const first = await createAccountModules("first-instance");
    const second = await createAccountModules("second-instance");

    const results = await Promise.all([
      first.account.initializeConsoleAdmin(databasePath),
      second.account.initializeConsoleAdmin(databasePath),
    ]);
    const winners = results.filter((result) => result.initialized);

    assert.equal(winners.length, 1);
    assert.deepEqual(results.filter((result) => !result.initialized), [
      { initialized: false },
    ]);

    const account = modules.account.getConsoleAdminAccount(databasePath);
    assert.equal(
      await modules.password.verifyConsolePassword(
        winners[0].password,
        account.passwordHash,
      ),
      true,
    );
  });

  it("clears existing sessions when initialization replaces the credential", async () => {
    const databasePath = await createDatabasePath();
    const database = insertAccount(databasePath, { passwordHash: null });
    database
      .prepare(
        `INSERT INTO console_sessions
          (token_hash, username, expires_at, credential_fingerprint)
         VALUES (?, ?, ?, ?)`,
      )
      .run("stale-token-hash", "legacy-owner", Date.now() + 60_000, "stale");
    database.close();

    const result = await modules.account.initializeConsoleAdmin(databasePath);
    assert.equal(result.initialized, true);

    const check = modules.database.openConsoleDatabase(databasePath);
    const row = check.prepare("SELECT COUNT(*) AS count FROM console_sessions").get();
    check.close();
    assert.equal(Number(row.count), 0);
  });

  it("retries a transient schema lock held by another process", async () => {
    const databasePath = await createDatabasePath();
    const holder = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { DatabaseSync } = require("node:sqlite");',
          "const database = new DatabaseSync(process.argv[1]);",
          'database.exec("PRAGMA journal_mode = WAL;");',
          'database.exec("BEGIN EXCLUSIVE;");',
          'process.stdout.write("LOCKED\\n");',
          "setTimeout(() => {",
          '  database.exec("COMMIT;");',
          "  database.close();",
          "}, 1200);",
        ].join("\n"),
        databasePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const holderExit = new Promise((resolve) => holder.once("exit", resolve));

    try {
      await new Promise((resolve, reject) => {
        let output = "";
        holder.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("LOCKED")) {
            resolve();
          }
        });
        holder.once("exit", (code) => {
          reject(new Error(`Schema lock holder exited early with ${code}`));
        });
      });

      const result = await modules.account.initializeConsoleAdmin(databasePath);
      assert.equal(result.initialized, true);
      const account = modules.account.getConsoleAdminAccount(databasePath);
      assert.equal(
        await modules.password.verifyConsolePassword(
          result.password,
          account.passwordHash,
        ),
        true,
      );
    } finally {
      if (holder.exitCode === null) {
        holder.kill("SIGKILL");
      }
      await holderExit;
    }
  });

  it("fails within one lock budget when schema creation stays blocked", async () => {
    const databasePath = await createDatabasePath();
    // The holder self-terminates so a broken opener cannot hang the suite.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { DatabaseSync } = require("node:sqlite");',
          "const database = new DatabaseSync(process.argv[1]);",
          'database.exec("PRAGMA journal_mode = WAL;");',
          'database.exec("BEGIN EXCLUSIVE;");',
          'process.stdout.write("LOCKED\\n");',
          "setTimeout(() => process.exit(0), 12000);",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
        databasePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const holderExit = new Promise((resolve) => holder.once("exit", resolve));

    try {
      await new Promise((resolve, reject) => {
        let output = "";
        holder.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("LOCKED")) {
            resolve();
          }
        });
        holder.once("exit", (code) => {
          reject(new Error(`Schema lock holder exited early with ${code}`));
        });
      });

      const started = performance.now();
      assert.throws(
        () => modules.database.openConsoleDatabase(databasePath),
        (error) => {
          const errcode = Reflect.get(error, "errcode");
          assert.ok(errcode === 5 || errcode === 6);
          return true;
        },
      );
      const elapsed = performance.now() - started;
      assert.ok(
        elapsed < 8000,
        `schema lock wait took ${Math.round(elapsed)}ms`,
      );
    } finally {
      if (holder.exitCode === null) {
        holder.kill("SIGKILL");
      }
      await holderExit;
    }
  });

  it("never persists the plaintext initial password in database files", async () => {
    const databasePath = await createDatabasePath();
    const result = await modules.account.initializeConsoleAdmin(databasePath);
    assert.equal(result.initialized, true);

    const candidates = [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ].filter((file) => existsSync(file));
    assert.ok(candidates.length >= 1);

    for (const file of candidates) {
      const bytes = await readFile(file);
      assert.equal(
        bytes.includes(Buffer.from(result.password, "utf8")),
        false,
        `plaintext password persisted in ${path.basename(file)}`,
      );
    }
  });
});
