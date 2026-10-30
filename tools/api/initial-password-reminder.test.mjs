import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import {
  TEST_ORIGIN,
  TEST_PASSWORD_HASH,
  TEST_USERNAME,
  clearAuthEnv,
  configureAuthEnv,
  createPasswordHash,
  createTestDatabasePath,
  dismissReminderRequest,
  loadAuthRoutes,
  loginRequest,
  sessionCookie,
  sessionGet,
  writeConsoleAdminAccount,
} from "./auth-fixtures.mjs";

const DISMISS_FAILED_MESSAGE = "保存提醒状态失败，请稍后重试。";
const UNAUTHENTICATED_BODY = {
  code: "CONSOLE_UNAUTHENTICATED",
  message: "未登录或会话已过期。",
};

const originalDateNow = Date.now;
const originalFetch = globalThis.fetch;
let authRoutes;
let databasePath;

beforeEach(async () => {
  globalThis.fetch = async () => {
    throw new Error("Initial-password reminder tests must not call upstream fetch");
  };

  const temp = await createTestDatabasePath();
  databasePath = temp.databasePath;
  await configureAuthEnv({ databasePath });
  authRoutes = await loadAuthRoutes();
});

afterEach(() => {
  clearAuthEnv();
  Date.now = originalDateNow;
  globalThis.fetch = originalFetch;
});

after(() => {
  clearAuthEnv();
  Date.now = originalDateNow;
  globalThis.fetch = originalFetch;
});

describe("initial password reminder dismissal", () => {
  it("rejects requests without a current authenticated session", async () => {
    await seedRandomInitialPassword();

    const anonymous = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      null,
    );
    const staleCookie = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      `komari_console_session=${"A".repeat(43)}`,
    );

    for (const response of [anonymous, staleCookie]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), UNAUTHENTICATED_BODY);
    }

    assert.deepEqual(await readReminderMetadata(await loginFor()), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });
  });

  it("rejects expired sessions before updating the reminder", async () => {
    let now = 1_700_000_000_000;
    Date.now = () => now;
    await seedRandomInitialPassword();
    const cookie = await loginFor();

    now += 8 * 60 * 60 * 1000 + 1;

    const expired = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );

    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), UNAUTHENTICATED_BODY);

    now = 1_700_000_000_000;
    assert.deepEqual(await readReminderMetadata(await loginFor()), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });
  });

  it("requires the exact configured origin and leaves the reminder enabled", async () => {
    await seedRandomInitialPassword();
    const cookie = await loginFor();

    for (const origin of [null, "https://attacker.example", `${TEST_ORIGIN}/`]) {
      const rejected = await dismissReminderRequest(
        authRoutes.dismissReminderRoute,
        cookie,
        { origin },
      );

      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get("cache-control"), "no-store");
      assert.deepEqual(await rejected.json(), {
        message: "请求来源校验失败。",
      });
    }

    assert.equal(
      (await readReminderMetadata(cookie)).reminderDismissed,
      false,
    );

    const accepted = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );
    assert.equal(accepted.status, 200);
    assert.equal((await readReminderMetadata(cookie)).reminderDismissed, true);
  });

  it("persists dismissal while keeping the random-password flag", async () => {
    await seedRandomInitialPassword();
    const cookie = await loginFor();

    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });

    const response = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
      {
        body: JSON.stringify({
          isRandomInitialPassword: false,
          reminderDismissed: false,
          username: "attacker",
        }),
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(payload, { reminderDismissed: true });
    assert.equal(JSON.stringify(payload).includes(TEST_PASSWORD_HASH), false);
    assert.equal(JSON.stringify(payload).includes("fingerprint"), false);

    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: true,
      reminderDismissed: true,
      username: TEST_USERNAME,
    });
  });

  it("returns success for repeated requests and keeps state across modules", async () => {
    await seedRandomInitialPassword();
    const cookie = await loginFor();

    const first = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );
    const second = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );

    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { reminderDismissed: true });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { reminderDismissed: true });

    const freshRoutes = await loadAuthRoutes({ marker: "fresh-reminder" });
    const freshSession = await sessionGet(freshRoutes.sessionRoute, cookie);

    assert.equal(freshSession.status, 200);
    assert.deepEqual(await freshSession.json(), {
      isRandomInitialPassword: true,
      reminderDismissed: true,
      username: TEST_USERNAME,
    });

    const repeated = await dismissReminderRequest(
      freshRoutes.dismissReminderRoute,
      cookie,
    );
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), { reminderDismissed: true });
  });

  it("rejects pre-change sessions and leaves the replacement reminder enabled", async () => {
    await seedRandomInitialPassword();
    const oldCookie = await loginFor();
    const replacementPassword = "replacement-password";

    await writeConsoleAdminAccount({
      databasePath,
      isRandomInitialPassword: true,
      passwordHash: createPasswordHash(replacementPassword),
      reminderDismissed: false,
    });

    const staleDismissal = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      oldCookie,
    );

    assert.equal(staleDismissal.status, 401);
    assert.deepEqual(await staleDismissal.json(), UNAUTHENTICATED_BODY);
    assert.deepEqual(await readReminderMetadata(await loginFor({
      password: replacementPassword,
    })), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });

    const newCookie = await loginFor({ password: replacementPassword });
    const newDismissal = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      newCookie,
    );

    assert.equal(newDismissal.status, 200);
    assert.deepEqual(await newDismissal.json(), { reminderDismissed: true });
    assert.deepEqual(await readReminderMetadata(newCookie), {
      isRandomInitialPassword: true,
      reminderDismissed: true,
      username: TEST_USERNAME,
    });
  });

  it("returns a sanitized 500 and rolls back when the update fails", async () => {
    await seedRandomInitialPassword();
    const cookie = await loginFor();
    installFailingUpdateTrigger();

    const failed = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );
    const payload = await failed.json();

    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    assert.deepEqual(payload, { message: DISMISS_FAILED_MESSAGE });
    assert.equal(JSON.stringify(payload).includes("synthetic"), false);

    removeFailingUpdateTrigger();
    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });

    const retry = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { reminderDismissed: true });
    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: true,
      reminderDismissed: true,
      username: TEST_USERNAME,
    });
  });

  it("evaluates session expiry after the write lock is acquired", async () => {
    const base = 1_700_000_000_000;
    const sessionTtlMs = 8 * 60 * 60 * 1000;
    Date.now = () => base;
    await seedRandomInitialPassword();
    const cookie = await loginFor();

    const clock = new SharedArrayBuffer(4);
    const state = new Int32Array(clock);
    const worker = new Worker(LOCK_HOLDER_SOURCE, {
      eval: true,
      workerData: { clock, databasePath },
    });

    try {
      await waitForWorkerMessage(worker, "locked");
      Date.now = () =>
        base + (Atomics.load(state, 0) === 2 ? sessionTtlMs + 1 : 0);

      const response = await dismissReminderRequest(
        authRoutes.dismissReminderRoute,
        cookie,
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), UNAUTHENTICATED_BODY);
    } finally {
      await worker.terminate();
    }

    Date.now = () => base;
    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });
  });

  it("re-reads replacement credentials after the write lock is acquired", async () => {
    const replacementPassword = "replacement-password";
    const replacementPasswordHash = createPasswordHash(replacementPassword);
    await seedRandomInitialPassword();
    const oldCookie = await loginFor();
    const worker = new Worker(REPLACEMENT_LOCK_SOURCE, {
      eval: true,
      workerData: { databasePath, replacementPasswordHash },
    });

    try {
      await waitForWorkerMessage(worker, "locked");

      // The worker's replacement credential is uncommitted, so this request
      // starts with the old credential just like a reset racing a stale tab.
      assert.deepEqual(readAccountRow(), {
        is_random_initial_password: 1,
        password_hash: TEST_PASSWORD_HASH,
        reminder_dismissed: 0,
      });

      const response = await dismissReminderRequest(
        authRoutes.dismissReminderRoute,
        oldCookie,
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), UNAUTHENTICATED_BODY);
    } finally {
      await worker.terminate();
    }

    // The worker committed a replacement credential but never touched the
    // session row, so rejection must come from the refreshed fingerprint.
    assert.deepEqual(readAccountRow(), {
      is_random_initial_password: 1,
      password_hash: replacementPasswordHash,
      reminder_dismissed: 0,
    });
    assert.equal(countSessionRows(), 1);

    const staleSession = await sessionGet(authRoutes.sessionRoute, oldCookie);
    assert.equal(staleSession.status, 401);
    assert.deepEqual(await staleSession.json(), UNAUTHENTICATED_BODY);

    const newCookie = await loginFor({ password: replacementPassword });
    assert.deepEqual(await readReminderMetadata(newCookie), {
      isRandomInitialPassword: true,
      reminderDismissed: false,
      username: TEST_USERNAME,
    });
  });

  it("does not enable the reminder for a non-initial password", async () => {
    const cookie = await loginFor();

    const response = await dismissReminderRequest(
      authRoutes.dismissReminderRoute,
      cookie,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reminderDismissed: true });
    assert.deepEqual(await readReminderMetadata(cookie), {
      isRandomInitialPassword: false,
      reminderDismissed: true,
      username: TEST_USERNAME,
    });
  });
});

async function seedRandomInitialPassword() {
  await writeConsoleAdminAccount({
    databasePath,
    isRandomInitialPassword: true,
    reminderDismissed: false,
  });
}

async function loginFor(options) {
  const response = await loginRequest(authRoutes.loginRoute, options);
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

async function readReminderMetadata(cookie) {
  const response = await sessionGet(authRoutes.sessionRoute, cookie);
  assert.equal(response.status, 200);
  return response.json();
}

function installFailingUpdateTrigger() {
  withDatabase((database) => {
    database.exec(
      `CREATE TRIGGER fail_reminder_update
       BEFORE UPDATE ON console_admin_account
       BEGIN
         SELECT RAISE(ABORT, 'synthetic update failure');
       END`,
    );
  });
}

function removeFailingUpdateTrigger() {
  withDatabase((database) => {
    database.exec("DROP TRIGGER IF EXISTS fail_reminder_update");
  });
}

function withDatabase(operation) {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    operation(database);
  } finally {
    database.close();
  }
}

function withDatabaseValue(operation) {
  const database = new DatabaseSync(databasePath);

  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    return operation(database);
  } finally {
    database.close();
  }
}

function readAccountRow() {
  const row = withDatabaseValue((database) =>
    database
      .prepare(
        `SELECT password_hash, is_random_initial_password, reminder_dismissed
         FROM console_admin_account
         WHERE id = 1`,
      )
      .get(),
  );

  return {
    is_random_initial_password: Number(row.is_random_initial_password),
    password_hash: String(row.password_hash),
    reminder_dismissed: Number(row.reminder_dismissed),
  };
}

function countSessionRows() {
  const row = withDatabaseValue((database) =>
    database.prepare("SELECT COUNT(*) AS count FROM console_sessions").get(),
  );

  return Number(row.count);
}

const LOCK_HOLDER_SOURCE = `
  const { DatabaseSync } = require("node:sqlite");
  const { parentPort, workerData } = require("node:worker_threads");
  const state = new Int32Array(workerData.clock);

  const database = new DatabaseSync(workerData.databasePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("BEGIN IMMEDIATE");
  parentPort.postMessage("locked");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  // Advance the clock while the writer lock is still held so the waiting
  // request can only observe it after BEGIN IMMEDIATE succeeds.
  Atomics.store(state, 0, 2);
  database.exec("ROLLBACK");
  database.close();
  parentPort.postMessage("released");
`;

const REPLACEMENT_LOCK_SOURCE = `
  const { DatabaseSync } = require("node:sqlite");
  const { parentPort, workerData } = require("node:worker_threads");

  const database = new DatabaseSync(workerData.databasePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("BEGIN IMMEDIATE");
  database
    .prepare(
      "UPDATE console_admin_account SET password_hash = ?, " +
        "is_random_initial_password = 1, reminder_dismissed = 0, " +
        "updated_at = ? WHERE id = 1",
    )
    .run(workerData.replacementPasswordHash, Date.now());
  parentPort.postMessage("locked");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  database.exec("COMMIT");
  database.close();
  parentPort.postMessage("released");
`;

function waitForWorkerMessage(worker, expected) {
  return new Promise((resolve, reject) => {
    function handleMessage(message) {
      if (message !== expected) {
        return;
      }

      worker.off("error", handleError);
      worker.off("message", handleMessage);
      resolve();
    }

    function handleError(error) {
      worker.off("error", handleError);
      worker.off("message", handleMessage);
      reject(error);
    }

    worker.on("error", handleError);
    worker.on("message", handleMessage);
  });
}
