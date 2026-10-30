import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TEST_ORIGIN,
  clearAuthEnv,
  loadAuthRoutes,
  loginRequest,
  sessionCookie,
  sessionGet,
} from "./auth-fixtures.mjs";
import { readDatabaseBytes } from "./maintenance-fixtures.mjs";
import { loadTypeScriptModule } from "./typescript-modules.mjs";

const builtinImports = {
  "node:crypto": "node:crypto",
  "node:fs": "node:fs",
  "node:path": "node:path",
  "node:sqlite": "node:sqlite",
};

const databaseUrl = loadTypeScriptModule(
  "src/lib/server/database.ts",
  builtinImports,
);
const passwordUrl = loadTypeScriptModule(
  "src/lib/server/password.ts",
  builtinImports,
);
const adminAccountUrl = loadTypeScriptModule("src/lib/server/admin-account.ts", {
  ...builtinImports,
  "./database": databaseUrl,
  "./password": passwordUrl,
});
const maintenanceSchemaUrl = loadTypeScriptModule(
  "src/lib/server/maintenance/schema.ts",
);

const modules = {
  account: await import(adminAccountUrl),
  database: await import(databaseUrl),
  password: await import(passwordUrl),
  schema: await import(maintenanceSchemaUrl),
};

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tmpRoot = path.join(repoRoot, "tmp");
const tempDirectories = [];

let authRoutes;
let cliPath;

before(async () => {
  await mkdir(tmpRoot, { recursive: true });
  const buildDirectory = await mkdtemp(path.join(tmpRoot, "password-reset-build-"));
  tempDirectories.push(buildDirectory);
  const outputDirectory = path.join(buildDirectory, "admin-tools");
  const build = await runProcess(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "build-admin-tools.mjs"),
      "--out-dir",
      outputDirectory,
    ],
    { cwd: repoRoot },
  );

  assert.equal(build.code, 0, build.stderr);
  cliPath = path.join(outputDirectory, "cli", "reset-password.js");
  assert.equal(existsSync(cliPath), true, "compiled reset-password CLI missing");
  authRoutes = await loadAuthRoutes();
});

afterEach(() => {
  clearAuthEnv();
});

after(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

async function createDatabasePath(prefix = "password-reset-") {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tmpRoot, prefix));
  tempDirectories.push(directory);
  return path.join(directory, "console.sqlite");
}

function withDatabase(databasePath, callback) {
  const database = modules.database.openConsoleDatabase(databasePath);

  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function seedAccount(
  databasePath,
  {
    createdAt = 1_700_000_000_000,
    isRandomInitialPassword = 0,
    passwordHash = null,
    reminderDismissed = 1,
    updatedAt = createdAt,
    username = "admin",
  } = {},
) {
  withDatabase(databasePath, (database) => {
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
  });
}

function seedSession(databasePath, { tokenHash = "seed-session-token" } = {}) {
  withDatabase(databasePath, (database) => {
    database
      .prepare(
        `INSERT INTO console_sessions
          (token_hash, username, expires_at, credential_fingerprint)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tokenHash, "admin", Date.now() + 60 * 60 * 1000, "seed-fingerprint");
  });
}

function readAdminRow(databasePath) {
  return withDatabase(databasePath, (database) =>
    database
      .prepare(
        `SELECT username, password_hash, is_random_initial_password,
                reminder_dismissed, created_at, updated_at
         FROM console_admin_account
         WHERE id = 1`,
      )
      .get(),
  );
}

function countSessions(databasePath) {
  return withDatabase(databasePath, (database) =>
    Number(
      database.prepare("SELECT COUNT(*) AS count FROM console_sessions").get()
        .count,
    ),
  );
}

function seedMaintenanceData(databasePath, { windowStartedAt = Date.now() } = {}) {
  withDatabase(databasePath, (database) => {
    modules.schema.ensureMaintenanceSchema(database);
    database
      .prepare(
        `INSERT INTO maintenance_notices
          (id, submission_id, input_fingerprint, title, content,
           maintenance_time, target_group_ids, mode, planned_at, status,
           version, created_at, updated_at, started_at, ended_at,
           last_executed_attempt_ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "notice-sent",
        "submission-sent",
        "fingerprint-sent",
        "维护通知已发送",
        "预计维护 10 分钟\n期间可能出现短暂不可用",
        "2026-11-01 22:00 - 23:00",
        "[101,202]",
        "immediate",
        null,
        "sent",
        3,
        1_700_000_050_000,
        1_700_000_060_000,
        1_700_000_051_000,
        1_700_000_060_000,
        1_700_000_060_000,
      );
    database
      .prepare(
        `INSERT INTO maintenance_notices
          (id, submission_id, input_fingerprint, title, content,
           maintenance_time, target_group_ids, mode, planned_at, status,
           version, created_at, updated_at, started_at, ended_at,
           last_executed_attempt_ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "notice-upcoming",
        "submission-upcoming",
        "fingerprint-upcoming",
        "定时维护通知",
        "预计维护 5 分钟",
        "2026-11-02 22:00 - 22:30",
        "[303]",
        "scheduled",
        1_700_000_200_000,
        "upcoming",
        1,
        1_700_000_070_000,
        1_700_000_070_000,
        null,
        null,
        null,
      );
    database
      .prepare(
        `INSERT INTO maintenance_attempts
          (id, notice_id, attempt_number, request_id, audit_reason, body_json,
           target_group_ids, phase, executed, started_at, ended_at,
           request_error, remaining_seconds, requires_reconciliation,
           owner_token, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "attempt-1",
        "notice-sent",
        1,
        "request-1",
        "维护通知",
        '{"title":"维护通知已发送"}',
        "[101,202]",
        "completed",
        1,
        1_700_000_051_000,
        1_700_000_060_000,
        null,
        12.5,
        0,
        null,
        null,
        1_700_000_050_000,
        1_700_000_060_000,
      );
    database
      .prepare(
        `INSERT INTO maintenance_attempts
          (id, notice_id, attempt_number, request_id, audit_reason, body_json,
           target_group_ids, phase, executed, started_at, ended_at,
           request_error, remaining_seconds, requires_reconciliation,
           owner_token, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "attempt-2",
        "notice-upcoming",
        1,
        "request-2",
        "定时维护通知",
        '{"title":"定时维护通知"}',
        "[303]",
        "queued",
        0,
        null,
        null,
        null,
        null,
        0,
        "worker-owner",
        1_700_000_300_000,
        1_700_000_070_000,
        1_700_000_070_000,
      );
    database
      .prepare(
        `INSERT INTO maintenance_attempt_results
          (attempt_id, group_id, position, outcome, reason, error_code, error,
           bot_id, requires_reconciliation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("attempt-1", 101, 0, "success", "ok", null, null, "bot-1", 0);
    database
      .prepare(
        `INSERT INTO maintenance_attempt_results
          (attempt_id, group_id, position, outcome, reason, error_code, error,
           bot_id, requires_reconciliation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "attempt-1",
        202,
        1,
        "failed",
        "upstream_error",
        "500",
        "上游返回错误",
        "bot-1",
        0,
      );
    database
      .prepare(
        `INSERT INTO maintenance_retry_submissions
          (submission_key, notice_id, attempt_id, fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "retry-1",
        "notice-sent",
        "attempt-1",
        "retry-fingerprint",
        1_700_000_065_000,
      );
    database
      .prepare(
        `INSERT INTO console_login_attempts
          (scope, failures, window_started_at)
         VALUES (?, ?, ?)`,
      )
      .run("admin", 10, windowStartedAt);
  });
}

function readMaintenanceSnapshot(databasePath) {
  return withDatabase(databasePath, (database) => {
    const rows = (sql) =>
      database
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));

    return {
      attempts: rows("SELECT * FROM maintenance_attempts ORDER BY id"),
      loginAttempts: rows(
        "SELECT * FROM console_login_attempts ORDER BY scope",
      ),
      notices: rows("SELECT * FROM maintenance_notices ORDER BY id"),
      results: rows(
        `SELECT * FROM maintenance_attempt_results
         ORDER BY attempt_id, group_id`,
      ),
      retrySubmissions: rows(
        `SELECT * FROM maintenance_retry_submissions
         ORDER BY submission_key`,
      ),
    };
  });
}

function configureAuth(databasePath) {
  process.env.CONSOLE_DATABASE_PATH = databasePath;
  process.env.CONSOLE_PUBLIC_ORIGIN = TEST_ORIGIN;
}

function cliEnvironment(databasePath, extraEnvironment = {}) {
  const environment = { ...process.env };
  delete environment.CONSOLE_DATABASE_PATH;
  delete environment.CONSOLE_PUBLIC_ORIGIN;
  delete environment.KOMARI_API_ORIGIN;
  delete environment.KOMARI_API_BEARER_TOKEN;
  delete environment.KOMARI_OPENAPI_URL;

  if (databasePath) {
    environment.CONSOLE_DATABASE_PATH = databasePath;
  }

  return { ...environment, ...extraEnvironment };
}

function runCli({ args = [], cwd = repoRoot, databasePath } = {}) {
  return runProcess(process.execPath, [cliPath, ...args], {
    cwd,
    env: cliEnvironment(databasePath),
  });
}

function runProcess(command, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
  });
}

function emittedPassword(stdout) {
  const matches = stdout.match(/^新密码：(.+)$/m);

  assert.ok(matches, `missing new password line in output:\n${stdout}`);
  return matches[1].trim();
}

function assertOnePasswordLine(stdout) {
  assert.equal((stdout.match(/^新密码：/gm) ?? []).length, 1);
}

describe("console password reset command", () => {
  it("resets a custom admin account and logs in with the emitted password", async () => {
    const databasePath = await createDatabasePath();
    const oldPassword = "old-console-password";
    const oldHash = await modules.password.hashConsolePassword(oldPassword);
    seedAccount(databasePath, {
      createdAt: 1_650_000_000_000,
      isRandomInitialPassword: 0,
      passwordHash: oldHash,
      reminderDismissed: 1,
      updatedAt: 1_650_000_500_000,
      username: "custom-owner",
    });

    configureAuth(databasePath);
    const oldLogin = await loginRequest(authRoutes.loginRoute, {
      password: oldPassword,
      username: "custom-owner",
    });
    assert.equal(oldLogin.status, 200);
    const oldCookie = sessionCookie(oldLogin);

    const result = await runCli({ databasePath });
    assert.equal(result.code, 0, result.stderr);
    assertOnePasswordLine(result.stdout);
    assert.match(result.stdout, /用户名：custom-owner/);
    assert.match(result.stdout, /仅显示这一次/);
    assert.match(result.stdout, /可以重复使用/);
    const password = emittedPassword(result.stdout);
    assert.match(password, /^[A-Za-z0-9_-]{32}$/);

    const row = readAdminRow(databasePath);
    assert.equal(row.username, "custom-owner");
    assert.equal(row.is_random_initial_password, 1);
    assert.equal(row.reminder_dismissed, 0);
    assert.equal(row.created_at, 1_650_000_000_000);
    assert.equal(
      await modules.password.verifyConsolePassword(password, row.password_hash),
      true,
    );
    assert.equal(
      await modules.password.verifyConsolePassword(oldPassword, row.password_hash),
      false,
    );
    assert.equal(countSessions(databasePath), 0);

    const newLogin = await loginRequest(authRoutes.loginRoute, {
      password,
      username: "custom-owner",
    });
    assert.equal(newLogin.status, 200);
    const session = await sessionGet(
      authRoutes.sessionRoute,
      sessionCookie(newLogin),
    );
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: "custom-owner",
    });

    const oldPasswordLogin = await loginRequest(authRoutes.loginRoute, {
      password: oldPassword,
      username: "custom-owner",
    });
    assert.equal(oldPasswordLogin.status, 401);

    const oldSession = await sessionGet(authRoutes.sessionRoute, oldCookie);
    assert.equal(oldSession.status, 401);
    const oldAuthorization = await authRoutes.authorizeConsoleRequest(
      new Request(`${TEST_ORIGIN}/api/console/announcements`, {
        headers: { cookie: oldCookie },
      }),
    );
    assert.equal(oldAuthorization.authorized, false);

    const bytes = readDatabaseBytes(databasePath);
    assert.equal(bytes.includes(Buffer.from(password, "utf8")), false);
  });

  it("resets a missing, NULL or empty password to the admin username", async () => {
    const scenarios = [
      { label: "missing" },
      { label: "null", passwordHash: null, username: "legacy-owner" },
      { label: "empty", passwordHash: "", username: "legacy-owner" },
    ];

    for (const scenario of scenarios) {
      const databasePath = await createDatabasePath();
      const createdAt = 1_600_000_000_000;

      if (scenario.label !== "missing") {
        seedAccount(databasePath, {
          createdAt,
          isRandomInitialPassword: 0,
          passwordHash: scenario.passwordHash,
          reminderDismissed: 1,
          updatedAt: createdAt,
          username: scenario.username,
        });
      }

      const result = await runCli({ databasePath });
      assert.equal(result.code, 0, `${scenario.label}: ${result.stderr}`);
      assert.match(result.stdout, /用户名：admin/);
      const password = emittedPassword(result.stdout);
      const row = readAdminRow(databasePath);

      assert.equal(row.username, "admin");
      assert.equal(row.is_random_initial_password, 1);
      assert.equal(row.reminder_dismissed, 0);
      assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      assert.equal(
        await modules.password.verifyConsolePassword(
          password,
          row.password_hash,
        ),
        true,
      );

      if (scenario.label !== "missing") {
        assert.equal(row.created_at, createdAt);
      }

      assert.equal(countSessions(databasePath), 0);
    }
  });

  it("repairs a malformed nonempty hash without changing the username", async () => {
    const databasePath = await createDatabasePath();
    const malformedHash = "scrypt$not-a-valid-hash";
    seedAccount(databasePath, {
      isRandomInitialPassword: 0,
      passwordHash: malformedHash,
      reminderDismissed: 1,
      username: "corrupted-owner",
    });
    seedSession(databasePath);

    const result = await runCli({ databasePath });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /用户名：corrupted-owner/);
    const password = emittedPassword(result.stdout);

    const row = readAdminRow(databasePath);
    assert.equal(row.username, "corrupted-owner");
    assert.equal(row.is_random_initial_password, 1);
    assert.equal(row.reminder_dismissed, 0);
    assert.notEqual(row.password_hash, malformedHash);
    assert.equal(
      await modules.password.verifyConsolePassword(password, row.password_hash),
      true,
    );
    assert.equal(countSessions(databasePath), 0);

    configureAuth(databasePath);
    const login = await loginRequest(authRoutes.loginRoute, {
      password,
      username: "corrupted-owner",
    });
    assert.equal(login.status, 200);
  });

  it("derives every reset from a fresh random salt", async () => {
    const databasePath = await createDatabasePath();
    const originalHash =
      await modules.password.hashConsolePassword("original-password");
    seedAccount(databasePath, {
      passwordHash: originalHash,
      username: "admin",
    });

    const first = await runCli({ databasePath });
    assert.equal(first.code, 0, first.stderr);
    const firstPassword = emittedPassword(first.stdout);
    const firstHash = readAdminRow(databasePath).password_hash;
    const firstSalt = firstHash.split("$")[1];

    const second = await runCli({ databasePath });
    assert.equal(second.code, 0, second.stderr);
    const secondPassword = emittedPassword(second.stdout);
    const secondHash = readAdminRow(databasePath).password_hash;
    const secondSalt = secondHash.split("$")[1];

    assert.notEqual(firstPassword, secondPassword);
    assert.notEqual(firstSalt, originalHash.split("$")[1]);
    assert.notEqual(secondSalt, firstSalt);
    assert.match(secondSalt, /^[0-9a-f]{32}$/);
    assert.equal(
      await modules.password.verifyConsolePassword(secondPassword, secondHash),
      true,
    );
    assert.equal(
      await modules.password.verifyConsolePassword(firstPassword, secondHash),
      false,
    );
  });

  it("fails without changing an account whose stored username is invalid", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword(
      "existing-password",
    );
    seedAccount(databasePath, {
      isRandomInitialPassword: 0,
      passwordHash: existingHash,
      reminderDismissed: 1,
      username: "",
    });
    seedSession(databasePath);

    await assert.rejects(
      modules.account.resetConsoleAdminPassword(databasePath),
      (error) => {
        assert.equal(
          error.message,
          modules.account.CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE,
        );
        assert.equal(error.message.includes(existingHash), false);
        return true;
      },
    );

    assert.deepEqual({ ...readAdminRow(databasePath) }, {
      created_at: 1_700_000_000_000,
      is_random_initial_password: 0,
      password_hash: existingHash,
      reminder_dismissed: 1,
      updated_at: 1_700_000_000_000,
      username: "",
    });
    assert.equal(countSessions(databasePath), 1);

    const result = await runCli({ databasePath });
    assert.notEqual(result.code, 0);
    assert.equal((result.stdout.match(/^新密码：/gm) ?? []).length, 0);
    assert.match(result.stderr, /控制台管理员账户不可用/);
    assert.equal(result.stderr.includes(existingHash), false);
    assert.equal(readAdminRow(databasePath).password_hash, existingHash);
    assert.equal(readAdminRow(databasePath).username, "");
    assert.equal(countSessions(databasePath), 1);
  });

  it("rejects every extra argument before touching credentials", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword(
      "existing-password",
    );
    seedAccount(databasePath, {
      passwordHash: existingHash,
      reminderDismissed: 1,
      updatedAt: 1_700_000_000_500,
      username: "admin",
    });
    seedSession(databasePath);
    const before = {
      ...readAdminRow(databasePath),
      sessions: countSessions(databasePath),
    };

    for (const args of [
      ["--password=custom-secret-value"],
      ["-p"],
      ["extra"],
    ]) {
      const result = await runCli({ args, databasePath });

      assert.notEqual(result.code, 0, `args ${args.join(" ")}`);
      assert.equal((result.stdout.match(/^新密码：/gm) ?? []).length, 0);
      assert.match(result.stderr, /不接受任何参数/);
      assert.equal(result.stderr.includes("custom-secret-value"), false);
      assert.equal(result.stdout.includes("custom-secret-value"), false);
    }

    assert.deepEqual(
      {
        ...readAdminRow(databasePath),
        sessions: countSessions(databasePath),
      },
      before,
    );
  });

  it("fails without creating a database when the configured path is missing", async () => {
    const directory = await mkdtemp(path.join(tmpRoot, "password-reset-env-"));
    tempDirectories.push(directory);

    const missing = await runProcess(process.execPath, [cliPath], {
      cwd: directory,
      env: cliEnvironment(null),
    });
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /CONSOLE_DATABASE_PATH/);
    assert.equal((missing.stdout.match(/^新密码：/gm) ?? []).length, 0);
    assert.deepEqual(await readdir(directory), []);

    const relative = await runCli({
      cwd: directory,
      databasePath: "relative-console.sqlite",
    });
    assert.notEqual(relative.code, 0);
    assert.match(relative.stderr, /CONSOLE_DATABASE_PATH/);
    assert.equal(existsSync(path.join(directory, "relative-console.sqlite")), false);
  });

  it("loads the database path from .env like the maintenance worker", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword(
      "existing-password",
    );
    seedAccount(databasePath, {
      passwordHash: existingHash,
      reminderDismissed: 1,
      username: "env-owner",
    });
    const directory = await mkdtemp(path.join(tmpRoot, "password-reset-dotenv-"));
    tempDirectories.push(directory);
    await writeFile(
      path.join(directory, ".env"),
      `CONSOLE_DATABASE_PATH=${databasePath}\n`,
    );

    const result = await runProcess(process.execPath, [cliPath], {
      cwd: directory,
      env: cliEnvironment(null),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /用户名：env-owner/);
    const password = emittedPassword(result.stdout);
    const row = readAdminRow(databasePath);
    assert.equal(row.username, "env-owner");
    assert.equal(
      await modules.password.verifyConsolePassword(password, row.password_hash),
      true,
    );
  });

  it("rolls back the account and sessions when the credential write fails", async () => {
    const databasePath = await createDatabasePath();
    const oldPassword = "old-password";
    const oldHash = await modules.password.hashConsolePassword(oldPassword);
    seedAccount(databasePath, {
      createdAt: 1_650_000_000_000,
      isRandomInitialPassword: 1,
      passwordHash: oldHash,
      reminderDismissed: 1,
      updatedAt: 1_650_000_000_500,
      username: "rollback-owner",
    });
    configureAuth(databasePath);
    const login = await loginRequest(authRoutes.loginRoute, {
      password: oldPassword,
      username: "rollback-owner",
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    const before = { ...readAdminRow(databasePath) };

    withDatabase(databasePath, (database) => {
      database.exec(
        `CREATE TRIGGER synthetic_session_delete_failure
         BEFORE DELETE ON console_sessions
         BEGIN
           SELECT RAISE(ABORT, 'synthetic write failure');
         END;`,
      );
    });

    const result = await runCli({ databasePath });
    assert.notEqual(result.code, 0);
    assert.equal((result.stdout.match(/^新密码：/gm) ?? []).length, 0);
    assert.equal(result.stderr.includes("synthetic write failure"), false);
    assert.match(result.stderr, /未修改原凭据和登录会话/);

    assert.deepEqual({ ...readAdminRow(databasePath) }, before);
    assert.equal(countSessions(databasePath), 1);

    const session = await sessionGet(authRoutes.sessionRoute, cookie);
    assert.equal(session.status, 200);
  });

  it("preserves maintenance history and the shared login window", async () => {
    const databasePath = await createDatabasePath();
    const existingHash = await modules.password.hashConsolePassword(
      "existing-password",
    );
    seedAccount(databasePath, {
      passwordHash: existingHash,
      reminderDismissed: 1,
      username: "data-owner",
    });
    seedMaintenanceData(databasePath);
    const before = readMaintenanceSnapshot(databasePath);

    assert.equal(before.notices.length, 2);
    assert.equal(before.attempts.length, 2);
    assert.equal(before.results.length, 2);
    assert.equal(before.retrySubmissions.length, 1);
    assert.equal(before.loginAttempts.length, 1);
    assert.equal(before.notices[0].title, "维护通知已发送");
    assert.equal(before.attempts[0].phase, "completed");
    assert.equal(before.attempts[1].owner_token, "worker-owner");
    assert.equal(before.results[1].outcome, "failed");
    assert.equal(before.loginAttempts[0].failures, 10);

    const result = await runCli({ databasePath });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readMaintenanceSnapshot(databasePath).notices.length, 2);
    assert.deepEqual(readMaintenanceSnapshot(databasePath), before);

    configureAuth(databasePath);
    const throttled = await loginRequest(authRoutes.loginRoute, {
      password: emittedPassword(result.stdout),
      username: "data-owner",
    });
    assert.equal(throttled.status, 429);
  });
});
