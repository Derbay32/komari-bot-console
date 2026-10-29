import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

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
  readJsonBody,
  startFakeUpstream,
  successfulResponse,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;
const SCHEDULED_WINDOW_MS = 60_000;
const T0 = 1_800_000_000_000;

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtureUrl = new URL("./maintenance-fixtures.mjs", import.meta.url).href;
const buildScript = path.join(root, "scripts/build-maintenance-worker.mjs");
const modules = await loadMaintenanceModules();

let temp;
let upstream;
let now;
let maintenance;
let routes;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-retention-test-");
  now = T0;
  upstream = await startFakeUpstream((request) => ({
    body: successfulResponse(readJsonBody(request).group_ids),
  }));
  maintenance = createService(() => now);
});

afterEach(async () => {
  clearAuthEnv();
  await upstream.close();
  await temp.cleanup();
  routes = undefined;
});

describe("notice history retention", () => {
  it("keeps the -1ms boundary, deletes at exactly 30 days, and repeats safely", async () => {
    const created = await createSendableNotice([101, 202], "retention-boundary");
    const baseline = await maintenance.get(created.notice.id);
    assert.ok(baseline);
    assert.equal(baseline.lastExecutedAttemptEndedAt, T0);
    assert.equal(upstream.requests.length, 1);

    now = T0 + RETENTION_MS - 1;
    await maintenance.runOnce();
    assert.deepEqual(await maintenance.get(created.notice.id), baseline);
    assert.deepEqual(
      (await maintenance.list()).map((notice) => notice.id),
      [created.notice.id],
    );

    now = T0 + RETENTION_MS;
    const deletionRun = await maintenance.runOnce();
    assert.equal(deletionRun.processed, false);
    assert.equal(await maintenance.get(created.notice.id), null);
    assert.deepEqual(await maintenance.list(), []);
    assert.equal(upstream.requests.length, 1);

    await maintenance.runOnce();
    now += 60_000;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(created.notice.id), null);
    assert.deepEqual(await maintenance.list(), []);

    configureAuthEnv({ databasePath: temp.databasePath });
    routes = await loadMaintenanceRoutes(modules);
    const cookie = await loginCookie();
    const missing = await callDetail(cookie, created.notice.id);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await missing.json(), { message: "通知不存在。" });

    const list = await callList(cookie);
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { notices: [] });
  });

  it("keeps an executed retry's whole notice until the newer attempt ages out", async () => {
    const created = await createSendableNotice(
      [101, 202],
      "retention-executed-retry",
      new Map([
        [
          202,
          resultEntry(202, {
            error: "平台拒绝发送",
            error_code: "send_failed",
            status: "failed",
            success: false,
          }),
        ],
      ]),
    );
    const firstDetail = await maintenance.get(created.notice.id);
    assert.ok(firstDetail);
    const firstAnchor = firstDetail.lastExecutedAttemptEndedAt;
    const firstRequestId = firstDetail.attempts[0].requestId;

    now = T0 + 29 * DAY_MS;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, [202]);
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retention-executed-retry-2",
    );
    assert.equal(retry.created, true);
    upstream.setHandler((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));
    await maintenance.runOnce();

    const afterRetry = await maintenance.get(created.notice.id);
    assert.ok(afterRetry);
    assert.equal(afterRetry.lastExecutedAttemptEndedAt, now);
    assert.notEqual(afterRetry.lastExecutedAttemptEndedAt, firstAnchor);
    assert.equal(afterRetry.attempts.length, 2);
    assert.equal(afterRetry.attempts[0].requestId, firstRequestId);
    assert.equal(afterRetry.attempts[0].results.length, 2);
    assert.equal(afterRetry.attempts[1].id, retry.attemptId);
    assert.equal(afterRetry.attempts[1].executed, true);
    const retryRequestId = afterRetry.attempts[1].requestId;
    assert.match(retryRequestId, /^maint-[0-9a-f-]{36}$/);
    assert.notEqual(retryRequestId, firstRequestId);
    const snapshot = afterRetry;

    now = T0 + 30 * DAY_MS;
    await maintenance.runOnce();
    assert.deepEqual(await maintenance.get(created.notice.id), snapshot);

    now = T0 + 29 * DAY_MS + RETENTION_MS - 1;
    await maintenance.runOnce();
    assert.deepEqual(await maintenance.get(created.notice.id), snapshot);

    now = T0 + 29 * DAY_MS + RETENTION_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(created.notice.id), null);

    const recreated = await createSendableNotice(
      [303],
      "retention-executed-retry-3",
    );
    const recreatedDetail = await maintenance.get(recreated.notice.id);
    assert.ok(recreatedDetail);
    assert.notEqual(recreatedDetail.id, created.notice.id);
    assert.notEqual(recreatedDetail.attempts[0].requestId, firstRequestId);
    assert.notEqual(recreatedDetail.attempts[0].requestId, retryRequestId);
  });

  it("keeps the old anchor when a real 429 retry is not executed", async () => {
    const created = await createSendableNotice(
      [501, 502],
      "retention-throttled-retry",
      allFailedEntries([501, 502]),
    );
    const anchor = created.detail.lastExecutedAttemptEndedAt;
    assert.equal(anchor, T0);

    now = T0 + RETENTION_MS;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retention-throttled-retry-2",
    );
    assert.equal(retry.created, true);
    assert.equal(retry.notice.activity, "queued");

    upstream.setHandler(() => ({
      body: {
        detail: { message: "发送过于频繁", remaining_seconds: 12.5 },
      },
      status: 429,
    }));
    const firstRun = await maintenance.runOnce();
    assert.equal(firstRun.processed, true);
    assert.equal(firstRun.attemptId, retry.attemptId);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 2);
    assert.equal(detail.attempts[1].id, retry.attemptId);
    assert.equal(detail.attempts[1].executed, false);
    assert.equal(detail.attempts[1].endedAt, now);
    assert.equal(detail.endedAt, now);
    assert.equal(detail.lastExecutedAttemptEndedAt, anchor);
    assert.equal(detail.attempts[1].remainingSeconds, 12.5);
    assert.deepEqual(detail.attempts[1].results, []);

    const secondRun = await maintenance.runOnce();
    assert.equal(secondRun.processed, false);
    assert.equal(await maintenance.get(created.notice.id), null);
    assert.deepEqual(await maintenance.list(), []);
  });
});

describe("retention reads and terminal fallbacks", () => {
  it("does not move the anchor when reads observe the notice", async () => {
    const created = await createSendableNotice([601, 602], "retention-reads");
    const baseline = await maintenance.get(created.notice.id);
    assert.ok(baseline);
    const anchor = baseline.lastExecutedAttemptEndedAt;

    now = T0 + RETENTION_MS - 1;

    for (let index = 0; index < 3; index += 1) {
      await maintenance.list();
      await maintenance.get(created.notice.id);
      await maintenance.previewRetry(created.notice.id);
    }

    const afterReads = await maintenance.get(created.notice.id);
    assert.ok(afterReads);
    assert.equal(afterReads.lastExecutedAttemptEndedAt, anchor);
    assert.deepEqual(afterReads, baseline);

    await maintenance.runOnce();
    assert.deepEqual(await maintenance.get(created.notice.id), baseline);

    now = T0 + RETENTION_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(created.notice.id), null);
  });

  it("uses ended_at for canceled and missed notices without an executed attempt", async () => {
    now = T0;
    const canceled = await maintenance.create(
      maintenanceInput({ groupIds: [701] }),
      "retention-canceled",
    );
    await maintenance.cancel(canceled.notice.id, { version: 1 });
    const canceledDetail = await maintenance.get(canceled.notice.id);
    assert.ok(canceledDetail);
    assert.equal(canceledDetail.status, "canceled");
    assert.equal(canceledDetail.lastExecutedAttemptEndedAt, null);
    assert.equal(canceledDetail.endedAt, T0);
    assert.equal(canceledDetail.attempts[0].executed, false);

    const plannedAt = T0 + SCHEDULED_WINDOW_MS;
    const missed = await maintenance.create(
      maintenanceInput({
        groupIds: [702],
        mode: "scheduled",
        plannedAt,
      }),
      "retention-missed",
    );
    now = plannedAt + SCHEDULED_WINDOW_MS + 1;
    await maintenance.runOnce();
    const missedAt = now;
    const missedDetail = await maintenance.get(missed.notice.id);
    assert.ok(missedDetail);
    assert.equal(missedDetail.status, "missed");
    assert.equal(missedDetail.lastExecutedAttemptEndedAt, null);
    assert.equal(missedDetail.endedAt, missedAt);

    now = T0 + RETENTION_MS - 1;
    await maintenance.runOnce();
    assert.ok(await maintenance.get(canceled.notice.id));
    assert.ok(await maintenance.get(missed.notice.id));

    now = T0 + RETENTION_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(canceled.notice.id), null);
    assert.ok(await maintenance.get(missed.notice.id));

    now = missedAt + RETENTION_MS - 1;
    await maintenance.runOnce();
    assert.ok(await maintenance.get(missed.notice.id));

    now = missedAt + RETENTION_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(missed.notice.id), null);
    assert.deepEqual(await maintenance.list(), []);
  });

  it("deletes success, failure, partial, and unknown outcomes at the same age", async () => {
    upstream.setHandler((request) => {
      const groupIds = readJsonBody(request).group_ids;

      return {
        body: upstreamResults(
          groupIds.map((groupId) => {
            if (groupId === 803 || groupId === 805) {
              return resultEntry(groupId, {
                error: "平台拒绝发送",
                error_code: "send_failed",
                status: "failed",
                success: false,
              });
            }

            if (groupId === 806) {
              return resultEntry(groupId, {
                error: "平台超时",
                error_code: "delivery_unknown",
                status: "failed",
                success: false,
              });
            }

            return resultEntry(groupId);
          }),
        ),
      };
    });

    const success = await maintenance.create(
      maintenanceInput({ groupIds: [801, 802] }),
      "retention-outcome-success",
    );
    const failed = await maintenance.create(
      maintenanceInput({ groupIds: [803] }),
      "retention-outcome-failed",
    );
    const partial = await maintenance.create(
      maintenanceInput({ groupIds: [804, 805] }),
      "retention-outcome-partial",
    );
    const unknown = await maintenance.create(
      maintenanceInput({ groupIds: [806] }),
      "retention-outcome-unknown",
    );

    for (let index = 0; index < 4; index += 1) {
      const run = await maintenance.runOnce();
      assert.equal(run.processed, true);
    }
    assert.equal((await maintenance.runOnce()).processed, false);

    const successDetail = await maintenance.get(success.notice.id);
    const failedDetail = await maintenance.get(failed.notice.id);
    const partialDetail = await maintenance.get(partial.notice.id);
    const unknownDetail = await maintenance.get(unknown.notice.id);
    assert.ok(successDetail);
    assert.ok(failedDetail);
    assert.ok(partialDetail);
    assert.ok(unknownDetail);
    assert.equal(successDetail.aggregate.allSuccess, true);
    assert.equal(failedDetail.aggregate.failed, 1);
    assert.equal(partialDetail.aggregate.success, 1);
    assert.equal(partialDetail.aggregate.failed, 1);
    assert.equal(unknownDetail.aggregate.unknown, 1);
    for (const detail of [
      successDetail,
      failedDetail,
      partialDetail,
      unknownDetail,
    ]) {
      assert.equal(detail.status, "sent");
      assert.equal(detail.lastExecutedAttemptEndedAt, T0);
    }

    now = T0 + RETENTION_MS - 1;
    await maintenance.runOnce();
    assert.deepEqual(await maintenance.get(success.notice.id), successDetail);
    assert.deepEqual(await maintenance.get(failed.notice.id), failedDetail);
    assert.deepEqual(await maintenance.get(partial.notice.id), partialDetail);
    assert.deepEqual(await maintenance.get(unknown.notice.id), unknownDetail);

    now = T0 + RETENTION_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(success.notice.id), null);
    assert.equal(await maintenance.get(failed.notice.id), null);
    assert.equal(await maintenance.get(partial.notice.id), null);
    assert.equal(await maintenance.get(unknown.notice.id), null);
    assert.deepEqual(await maintenance.list(), []);
  });
});

describe("active attempt protection", () => {
  it("keeps a future queued scheduled notice", async () => {
    now = T0 + 31 * DAY_MS;
    const plannedAt = now + 10 * DAY_MS;
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [901], mode: "scheduled", plannedAt }),
      "retention-future-queued",
    );
    assert.equal(created.notice.status, "upcoming");
    assert.equal(created.notice.activity, "queued");

    const run = await maintenance.runOnce();
    assert.equal(run.processed, false);
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "upcoming");
    assert.equal(detail.activity, "queued");
    assert.equal(detail.lastExecutedAttemptEndedAt, null);
  });

  it("keeps an aged notice whose retry is running in a held upstream request", async () => {
    const created = await createSendableNotice(
      [911],
      "retention-running",
      allFailedEntries([911]),
    );
    const firstAnchor = created.detail.lastExecutedAttemptEndedAt;

    now = T0 + 31 * DAY_MS;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retention-running-retry",
    );
    assert.equal(retry.created, true);

    let releaseRequest;
    const gate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    upstream.setHandler(async (request) => {
      await gate;
      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });

    const heldRun = maintenance.runOnce();

    try {
      await waitFor(async () => {
        const detail = await maintenance.get(created.notice.id);
        return detail?.activity === "running";
      }, 10_000);
      assert.equal(upstream.requests.length, 2);

      const otherLoop = createService(() => now);
      const idle = await otherLoop.runOnce();
      assert.equal(idle.processed, false);

      const runningDetail = await maintenance.get(created.notice.id);
      assert.ok(runningDetail);
      assert.equal(runningDetail.activity, "running");
      assert.equal(runningDetail.attempts.length, 2);
      assert.equal(runningDetail.attempts[1].id, retry.attemptId);
      assert.equal(runningDetail.lastExecutedAttemptEndedAt, firstAnchor);

      releaseRequest();
      const completed = await heldRun;
      assert.equal(completed.processed, true);
      assert.equal(completed.attemptId, retry.attemptId);

      const finalDetail = await maintenance.get(created.notice.id);
      assert.ok(finalDetail);
      assert.equal(finalDetail.activity, null);
      assert.equal(finalDetail.attempts[1].executed, true);
      assert.equal(finalDetail.lastExecutedAttemptEndedAt, now);
      assert.equal(upstream.requests.length, 2);
    } finally {
      releaseRequest();
      await heldRun.catch(() => {
        // Keep the original assertion failure when the held run also fails.
      });
    }
  });

  it("protects a queued retry on an aged notice until the claim runs", async () => {
    const created = await createSendableNotice(
      [921],
      "retention-queued-retry",
      allFailedEntries([921]),
    );
    assert.equal(created.detail.lastExecutedAttemptEndedAt, T0);

    now = T0 + 31 * DAY_MS;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retention-queued-retry-2",
    );
    assert.equal(retry.created, true);
    upstream.setHandler((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));

    const run = await maintenance.runOnce();
    assert.equal(run.processed, true);
    assert.equal(run.attemptId, retry.attemptId);
    assert.equal(upstream.requests.length, 2);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 2);
    assert.equal(detail.attempts[1].id, retry.attemptId);
    assert.equal(detail.attempts[1].executed, true);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
  });
});

describe("cleanup and retry serialization", () => {
  it("drops a retry enqueue that arrives after cleanup", async () => {
    const created = await createSendableNotice([931], "retention-cleanup-first");
    const oldDetail = await maintenance.get(created.notice.id);
    assert.ok(oldDetail);
    const previewVersion = oldDetail.version;

    now = T0 + 31 * DAY_MS;
    await maintenance.runOnce();
    assert.equal(await maintenance.get(created.notice.id), null);

    await assert.rejects(
      maintenance.retry(
        created.notice.id,
        { groupIds: [931], version: previewVersion },
        "retention-cleanup-first-retry",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceNotFoundError");
        return true;
      },
    );
    assert.equal(upstream.requests.length, 1);
  });

  it("samples the run-loop clock only while the write lock is held", async () => {
    const created = await createSendableNotice(
      [941],
      "retention-clock-under-lock",
    );
    const value = T0 + RETENTION_MS;
    let reads = 0;
    const lockAwareClock = () => {
      reads += 1;
      const probe = new DatabaseSync(temp.databasePath);

      try {
        probe.exec("BEGIN IMMEDIATE");
        probe.exec("ROLLBACK");
        throw new Error("维护保留时钟在没有写事务锁时被读取。");
      } catch (error) {
        if (String(error.message).includes("没有写事务锁")) {
          throw error;
        }
      } finally {
        probe.close();
      }

      return value;
    };
    const lockAwareService = modules.service.createMaintenanceService({
      databasePath: temp.databasePath,
      now: lockAwareClock,
      upstream: {
        apiOrigin: upstream.origin,
        bearerToken: TEST_BACKEND_TOKEN,
      },
    });

    await lockAwareService.runOnce();
    assert.ok(reads > 0);
    assert.equal(await maintenance.get(created.notice.id), null);
  });

  it(
    "serializes cleanup against a retry across two OS processes",
    { timeout: 60_000 },
    async () => {
      const created = await createSendableNotice(
        [951],
        "retention-race",
        allFailedEntries([951]),
      );
      const raceNow = T0 + 31 * DAY_MS;
      now = raceNow;
      const preview = await maintenance.previewRetry(created.notice.id);
      assert.ok(preview);
      const children = [];

      try {
        children.push(
          startChild({
            databasePath: temp.databasePath,
            now: raceNow,
            operation: "runOnce",
            upstreamOrigin: upstream.origin,
          }),
          startChild({
            databasePath: temp.databasePath,
            now: raceNow,
            operation: "retry",
            noticeId: created.notice.id,
            retry: {
              groupIds: preview.targetGroupIds,
              version: preview.version,
            },
            submissionId: "retention-race-retry",
            upstreamOrigin: upstream.origin,
          }),
        );
        assert.notEqual(children[0].child.pid, process.pid);
        assert.notEqual(children[0].child.pid, children[1].child.pid);

        await waitForChildrenReady(children);
        await releaseChildren(children);
        const [cleanupResult, retryResult] = await withTimeout(
          Promise.all(children.map((child) => child.result.promise)),
          20_000,
          "cleanup/retry child results",
        );
        const exitStates = await waitForChildrenExit(children);
        assert.equal(exitStates[0].code, 0, children[0].stderr);
        assert.equal(exitStates[1].code, 0, children[1].stderr);
        assert.equal(cleanupResult.status, "fulfilled");

        const detail = await maintenance.get(created.notice.id);

        if (retryResult.status === "fulfilled") {
          assert.equal(retryResult.value.created, true);
          assert.equal(cleanupResult.value.processed, true);
          assert.ok(detail);
          assert.equal(detail.attempts.length, 2);
          assert.equal(detail.attempts[1].executed, true);
          assert.equal(detail.activity, null);
          assert.equal(detail.lastExecutedAttemptEndedAt, raceNow);
          assert.equal(upstream.requests.length, 2);
        } else {
          assert.equal(retryResult.error.name, "MaintenanceNotFoundError");
          assert.equal(cleanupResult.value.processed, false);
          assert.equal(detail, null);
          assert.equal(upstream.requests.length, 1);
        }

        assertNoOrphans(temp.databasePath);
      } finally {
        await stopChildren(children);
      }
    },
  );
});

describe("retention cascade and worker CLI", () => {
  it(
    "removes content, attempts, results, and retry receipts while the worker cleans up",
    { timeout: 120_000 },
    async () => {
      const realNow = Date.now();
      const oldBase = realNow - 40 * DAY_MS;
      const oldService = createService(() => oldBase);
      const oldNotice = await oldService.create(
        maintenanceInput({ groupIds: [961, 962] }),
        "retention-cascade-old",
      );
      upstream.setHandler((request) => ({
        body: successfulResponse(
          readJsonBody(request).group_ids,
          allFailedEntries([962]),
        ),
      }));
      await oldService.runOnce();
      const firstDetail = await oldService.get(oldNotice.notice.id);
      assert.ok(firstDetail);
      const preview = await oldService.previewRetry(oldNotice.notice.id);
      assert.ok(preview);
      await oldService.retry(
        oldNotice.notice.id,
        { groupIds: [962], version: preview.version },
        "retention-cascade-old-retry",
      );
      const retryService = createService(() => oldBase + 1_000);
      await retryService.runOnce();
      const oldDetail = await retryService.get(oldNotice.notice.id);
      assert.ok(oldDetail);
      assert.equal(oldDetail.attempts.length, 2);
      const oldAttemptIds = oldDetail.attempts.map((attempt) => attempt.id);

      const youngService = createService(() => realNow);
      const youngNotice = await youngService.create(
        maintenanceInput({
          groupIds: [963],
          mode: "scheduled",
          plannedAt: realNow + 10 * DAY_MS,
        }),
        "retention-cascade-young",
      );
      const youngSnapshot = await youngService.get(youngNotice.notice.id);
      assert.ok(youngSnapshot);
      assert.equal(youngSnapshot.status, "upcoming");
      assert.equal(youngSnapshot.attempts.length, 1);
      assert.equal(youngSnapshot.attempts[0].phase, "queued");
      const requestCountBeforeWorker = upstream.requests.length;

      const buildRoot = path.join(root, "tmp");
      await mkdir(buildRoot, { recursive: true });
      const buildDirectory = await mkdtemp(
        path.join(buildRoot, "retention-worker-"),
      );
      const child = { exit: null, process: null };

      try {
        const outputDirectory = path.join(buildDirectory, "dist");
        const build = await runProcess(process.execPath, [
          buildScript,
          "--out-dir",
          outputDirectory,
        ]);
        assert.equal(build.code, 0, build.stderr);
        const workerEntry = path.join(
          outputDirectory,
          "worker",
          "maintenance-worker.js",
        );

        child.process = spawn(process.execPath, [workerEntry], {
          cwd: buildDirectory,
          env: {
            CONSOLE_DATABASE_PATH: temp.databasePath,
            HOME: buildDirectory,
            KOMARI_API_BEARER_TOKEN: TEST_BACKEND_TOKEN,
            KOMARI_API_ORIGIN: upstream.origin,
            PATH: process.env.PATH,
            TMPDIR: buildDirectory,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.exit = collectExit(child.process);

        await waitFor(async () => {
          const lookup = await youngService.get(oldNotice.notice.id);
          return lookup === null;
        }, 15_000);
        assert.equal(upstream.requests.length, requestCountBeforeWorker);
        assert.deepEqual(
          await youngService.get(youngNotice.notice.id),
          youngSnapshot,
        );

        const exit = await terminateWorker(child.process, child.exit);
        assert.equal(exit.code, 0, exit.stderr);

        const database = new DatabaseSync(temp.databasePath, {
          readOnly: true,
        });

        try {
          for (const attemptId of oldAttemptIds) {
            assert.equal(
              scalar(
                database,
                "SELECT COUNT(*) AS count FROM maintenance_attempt_results WHERE attempt_id = ?",
                attemptId,
              ),
              0,
            );
          }
          assert.equal(
            scalar(
              database,
              "SELECT COUNT(*) AS count FROM maintenance_attempts WHERE notice_id = ?",
              oldNotice.notice.id,
            ),
            0,
          );
          assert.equal(
            scalar(
              database,
              "SELECT COUNT(*) AS count FROM maintenance_retry_submissions WHERE notice_id = ?",
              oldNotice.notice.id,
            ),
            0,
          );
          assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
        } finally {
          database.close();
        }

        configureAuthEnv({ databasePath: temp.databasePath });
        routes = await loadMaintenanceRoutes(modules);
        const cookie = await loginCookie();
        const list = await callList(cookie);
        assert.equal(list.status, 200);
        const listed = await list.json();
        assert.deepEqual(
          listed.notices.map((notice) => notice.id),
          [youngNotice.notice.id],
        );
        const youngDetail = await callDetail(cookie, youngNotice.notice.id);
        assert.equal(youngDetail.status, 200);
        assert.equal(
          (await youngDetail.json()).notice.attempts.length,
          1,
        );
        const oldDetailResponse = await callDetail(
          cookie,
          oldNotice.notice.id,
        );
        assert.equal(oldDetailResponse.status, 404);
      } finally {
        if (child.process && child.process.exitCode === null) {
          child.process.kill("SIGKILL");
          await child.exit;
        }
        await rm(buildDirectory, { force: true, recursive: true });
      }
    },
  );
});

const CHILD_SOURCE = [
  `import { loadMaintenanceModules } from ${JSON.stringify(fixtureUrl)};`,
  "const modules = await loadMaintenanceModules();",
  "const maintenance = modules.service.createMaintenanceService({",
  "  databasePath: process.env.CHILD_DB,",
  "  now: () => Number(process.env.CHILD_NOW),",
  "  upstream: {",
  "    apiOrigin: process.env.CHILD_UPSTREAM,",
  '    bearerToken: "retention-race-synthetic-token",',
  "  },",
  "});",
  "const send = (payload) => new Promise((resolve, reject) => {",
  "  if (!process.connected) {",
  '    reject(new Error("IPC channel closed before result"));',
  "    return;",
  "  }",
  "  process.send(payload, (error) => {",
  "    if (error) reject(error);",
  "    else resolve();",
  "  });",
  "});",
  "const finish = async (payload) => {",
  "  try {",
  "    await send(payload);",
  "  } finally {",
  "    if (process.connected) process.disconnect();",
  "  }",
  "};",
  "process.on('message', async (message) => {",
  "  if (!message || message.type !== 'go') return;",
  "  try {",
  "    let value;",
  "    if (process.env.CHILD_OP === 'runOnce') {",
  "      value = await maintenance.runOnce();",
  "    } else if (process.env.CHILD_OP === 'retry') {",
  "      value = await maintenance.retry(",
  "        process.env.CHILD_ID,",
  "        JSON.parse(process.env.CHILD_RETRY),",
  "        process.env.CHILD_SUBMISSION,",
  "      );",
  "    } else {",
  "      throw new Error('unknown child operation');",
  "    }",
  "    await finish({ type: 'result', status: 'fulfilled', value });",
  "  } catch (error) {",
  "    await finish({",
  "      type: 'result',",
  "      status: 'rejected',",
  "      error: { name: (error && error.name) || 'Error', message: (error && error.message) || String(error) },",
  "    });",
  "  }",
  "});",
  "await send({ type: 'ready' });",
].join("\n");

function createService(nowProvider) {
  return modules.service.createMaintenanceService({
    databasePath: temp.databasePath,
    now: nowProvider,
    upstream: {
      apiOrigin: upstream.origin,
      bearerToken: TEST_BACKEND_TOKEN,
    },
  });
}

async function createSendableNotice(groupIds, submissionId, overrides) {
  const created = await maintenance.create(
    maintenanceInput({ groupIds }),
    submissionId,
  );
  upstream.setHandler((request) =>
    overrides
      ? { body: successfulResponse(readJsonBody(request).group_ids, overrides) }
      : { body: successfulResponse(readJsonBody(request).group_ids) },
  );
  await maintenance.runOnce();
  const detail = await maintenance.get(created.notice.id);
  assert.ok(detail);

  return { created: created.created, detail, notice: created.notice };
}

function resultEntry(groupId, patch = {}) {
  return {
    bot_id: "bot-1",
    error: null,
    error_code: null,
    group_id: groupId,
    status: "success",
    success: true,
    ...patch,
  };
}

function upstreamResults(entries, extra = {}) {
  return { results: entries, total: entries.length, ...extra };
}

function allFailedEntries(groupIds) {
  return new Map(
    groupIds.map((groupId) => [
      groupId,
      resultEntry(groupId, {
        error: "平台拒绝发送",
        error_code: "send_failed",
        status: "failed",
        success: false,
      }),
    ]),
  );
}

function scalar(database, sql, ...params) {
  const row = database.prepare(sql).get(...params);

  return Number(row.count);
}

function assertNoOrphans(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    for (const [label, sql] of [
      [
        "attempts",
        "SELECT COUNT(*) AS count FROM maintenance_attempts AS a LEFT JOIN maintenance_notices AS n ON n.id = a.notice_id WHERE n.id IS NULL",
      ],
      [
        "results",
        "SELECT COUNT(*) AS count FROM maintenance_attempt_results AS r LEFT JOIN maintenance_attempts AS a ON a.id = r.attempt_id WHERE a.id IS NULL",
      ],
      [
        "retry receipts",
        "SELECT COUNT(*) AS count FROM maintenance_retry_submissions AS s LEFT JOIN maintenance_notices AS n ON n.id = s.notice_id LEFT JOIN maintenance_attempts AS a ON a.id = s.attempt_id WHERE n.id IS NULL OR a.id IS NULL",
      ],
    ]) {
      assert.equal(scalar(database, sql), 0, `${label} must not be orphaned`);
    }

    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
}

async function loginCookie() {
  const login = await loginRequest(routes.loginRoute);
  return sessionCookie(login);
}

function callList(cookie) {
  return routes.listRoute.GET(
    new NextRequest(`${TEST_ORIGIN}/api/console/announcements`, {
      headers: { cookie },
    }),
  );
}

function callDetail(cookie, id) {
  return routes.detailRoute.GET(
    new NextRequest(
      `${TEST_ORIGIN}/api/console/announcements/${encodeURIComponent(id)}`,
      { headers: cookie ? { cookie } : {} },
    ),
    { params: Promise.resolve({ id }) },
  );
}

function startChild(options) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", CHILD_SOURCE],
    {
      cwd: root,
      env: {
        ...process.env,
        CHILD_DB: options.databasePath,
        CHILD_ID: options.noticeId ?? "",
        CHILD_NOW: String(options.now),
        CHILD_OP: options.operation,
        CHILD_RETRY: options.retry ? JSON.stringify(options.retry) : "",
        CHILD_SUBMISSION: options.submissionId ?? "",
        CHILD_UPSTREAM: options.upstreamOrigin,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const state = {
    child,
    exit: deferred(),
    exited: false,
    ready: deferred(),
    readySettled: false,
    result: deferred(),
    resultSettled: false,
    stderr: "",
    stdout: "",
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    state.stderr += chunk;
  });
  child.on("message", (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "ready" && !state.readySettled) {
      state.readySettled = true;
      state.ready.resolve();
      return;
    }

    if (message.type === "result" && !state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve(message);
    }
  });
  child.on("error", (error) => {
    if (!state.readySettled) {
      state.readySettled = true;
      state.ready.reject(error);
    }

    if (!state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve({
        error: { message: error.message, name: error.name },
        status: "rejected",
        type: "result",
      });
    }
  });
  child.on("exit", (code, signal) => {
    state.exited = true;
    state.exit.resolve({ code, signal });

    if (!state.readySettled) {
      state.readySettled = true;
      state.ready.reject(
        new Error(
          `子进程在就绪前退出（code=${code}, signal=${signal}）：${state.stderr}`,
        ),
      );
    }

    if (!state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve({
        error: {
          message: `子进程未返回结果即退出（code=${code}, signal=${signal}）：${state.stderr}`,
          name: "ChildExitError",
        },
        status: "rejected",
        type: "result",
      });
    }
  });

  return state;
}

async function waitForChildrenReady(children) {
  await withTimeout(
    Promise.all(children.map((child) => child.ready.promise)),
    20_000,
    "child ready barrier",
  );
}

async function releaseChildren(children) {
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.child.send({ type: "go" }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
}

async function waitForChildrenExit(children) {
  return withTimeout(
    Promise.all(children.map((child) => child.exit.promise)),
    10_000,
    "child exit",
  );
}

async function stopChildren(children) {
  for (const child of children) {
    if (!child.exited) {
      try {
        child.child.kill("SIGKILL");
      } catch {
        // The child may already be gone; cleanup continues.
      }
    }
  }

  await Promise.all(
    children.map((child) =>
      Promise.race([
        child.exit.promise,
        new Promise((resolve) => {
          setTimeout(resolve, 1_000);
        }),
      ]),
    ),
  );
}

function terminateWorker(child, exitPromise) {
  if (child.exitCode !== null) {
    return exitPromise;
  }

  child.kill("SIGTERM");
  return exitPromise;
}

function collectExit(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr, stdout }));
  });
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();

  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("等待条件超时。");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${timeoutMs}ms）。`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
