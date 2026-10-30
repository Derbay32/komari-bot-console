import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTempDatabase,
  loadMaintenanceModules,
  maintenanceInput,
  readJsonBody,
  startFakeUpstream,
  successfulResponse,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const modules = await loadMaintenanceModules();
const { service } = modules;

let temp;
let now;
let maintenance;
let upstream;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-retry-test-");
  now = 1_800_000_000_000;
  upstream = await startFakeUpstream((request) => ({
    body: successfulResponse(readJsonBody(request).group_ids),
  }));
  maintenance = createService(temp.databasePath, () => now);
});

afterEach(async () => {
  await upstream.close();
  await temp.cleanup();
});

function createService(databasePath, nowProvider, provider) {
  return service.createMaintenanceService({
    databasePath,
    now: nowProvider,
    upstream:
      provider ??
      ({
        apiOrigin: upstream.origin,
        bearerToken: TEST_BACKEND_TOKEN,
      }),
  });
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
  return { body: { results: entries, total: entries.length, ...extra } };
}

describe("manual retry preview", () => {
  it("previews only definite failures from a ten-group send in original order", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-preview-eight-two",
    );
    upstream.setHandler(() =>
      upstreamResults(
        [...groupIds].reverse().map((groupId) =>
          groupId === 103 || groupId === 109
            ? resultEntry(groupId, {
                error: "敏感词拦截",
                error_code: "send_failed",
                status: "failed",
                success: false,
              })
            : resultEntry(groupId),
        ),
      ),
    );

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const preview = await maintenance.previewRetry(created.notice.id);

    assert.ok(preview);
    assert.equal(preview.noticeId, created.notice.id);
    assert.equal(preview.version, detail.version);
    assert.equal(preview.title, detail.title);
    assert.equal(preview.content, detail.content);
    assert.equal(preview.maintenanceTime, detail.maintenanceTime);
    assert.deepEqual(preview.targetGroupIds, [103, 109]);
    assert.equal(preview.blockedReason, null);
    assert.equal(detail.aggregate.success, 8);
    assert.equal(detail.aggregate.failed, 2);
  });

  it("excludes success, unknown, missing, and unrecognized evidence", async () => {
    const groupIds = [201, 202, 203, 204, 205, 206, 207];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-preview-exclusions",
    );
    upstream.setHandler(() =>
      upstreamResults([
        resultEntry(207, {
          error: "failed",
          error_code: "send_failed",
          status: "success",
          success: true,
        }),
        resultEntry(204, {
          error: "平台超时",
          error_code: "delivery_unknown",
          status: "failed",
          success: false,
        }),
        resultEntry(203, {
          bot_id: null,
          error: "bot 未入群",
          error_code: "group_unreachable",
          status: "unreachable",
          success: false,
        }),
        resultEntry(202, {
          error: "敏感词拦截",
          error_code: "send_failed",
          status: "failed",
          success: false,
        }),
        resultEntry(206, {
          error: "未知原因",
          error_code: "mystery_code",
          status: "failed",
          success: false,
        }),
        resultEntry(201),
      ]),
    );

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const preview = await maintenance.previewRetry(created.notice.id);

    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, [202, 203]);
    assert.equal(preview.blockedReason, null);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [204, 205, 206, 207]);
  });

  it("returns an empty preview with a reason when nothing is eligible or busy", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [301, 302] }),
      "retry-preview-all-success",
    );
    await maintenance.runOnce();
    const successPreview = await maintenance.previewRetry(created.notice.id);

    assert.ok(successPreview);
    assert.deepEqual(successPreview.targetGroupIds, []);
    assert.match(successPreview.blockedReason ?? "", /没有/);

    const queued = await maintenance.create(
      maintenanceInput({ groupIds: [303] }),
      "retry-preview-busy",
    );
    const busyPreview = await maintenance.previewRetry(queued.notice.id);

    assert.ok(busyPreview);
    assert.deepEqual(busyPreview.targetGroupIds, []);
    assert.match(busyPreview.blockedReason ?? "", /排队|执行中/);
  });

  it("returns null for an unknown notice id", async () => {
    assert.equal(await maintenance.previewRetry("missing-notice"), null);
  });
});

describe("manual retry enqueue", () => {
  it("appends a new attempt for the failed subset and preserves prior results", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-enqueue-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));

    now += 1_000;
    await maintenance.runOnce();
    const firstEndedAt = now;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);

    now += 1_000;
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-enqueue-key",
    );

    assert.equal(retry.created, true);
    assert.equal(retry.notice.id, created.notice.id);
    assert.equal(retry.notice.status, "sent");
    assert.equal(retry.notice.mode, "immediate");
    assert.equal(retry.notice.plannedAt, null);
    assert.equal(retry.notice.attemptCount, 2);
    assert.equal(retry.notice.version, preview.version + 1);
    assert.equal(retry.notice.lastExecutedAttemptEndedAt, firstEndedAt);
    assert.equal(retry.notice.activity, "queued");

    const queued = await maintenance.get(created.notice.id);
    assert.ok(queued);
    assert.equal(queued.attempts.length, 2);
    const originalAttempt = queued.attempts[0];
    const retryAttempt = queued.attempts[1];
    assert.equal(retryAttempt.id, retry.attemptId);
    assert.equal(retryAttempt.number, 2);
    assert.equal(retryAttempt.phase, "queued");
    assert.equal(retryAttempt.executed, false);
    assert.equal(retryAttempt.auditReason, "手动重试维护通知");
    assert.match(retryAttempt.requestId, /^maint-[0-9a-f-]{36}$/);
    assert.notEqual(retryAttempt.requestId, originalAttempt.requestId);
    assert.deepEqual(retryAttempt.targetGroupIds, [103, 109]);
    assert.deepEqual(retryAttempt.requestBody, {
      content: originalAttempt.requestBody.content,
      group_ids: [103, 109],
      scheduled_time: originalAttempt.requestBody.scheduled_time,
      title: originalAttempt.requestBody.title,
    });
    assert.equal(originalAttempt.results.length, 10);

    upstream.setHandler((request) =>
      upstreamResults(
        readJsonBody(request).group_ids.map((groupId) => resultEntry(groupId)),
      ),
    );
    now += 1_000;
    const secondRun = await maintenance.runOnce();
    assert.equal(secondRun.processed, true);
    assert.equal(secondRun.attemptId, retry.attemptId);

    assert.equal(upstream.requests.length, 2);
    assert.deepEqual(readJsonBody(upstream.requests[1]).group_ids, [103, 109]);
    assert.equal(
      upstream.requests[1].headers["x-request-id"],
      retryAttempt.requestId,
    );
    assert.equal(
      decodeAuditReason(upstream.requests[1].headers["x-komari-change-reason"]),
      "手动重试维护通知",
    );

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 2);
    assert.deepEqual(
      detail.attempts[0].results.map((result) => [
        result.groupId,
        result.outcome,
      ]),
      groupIds.map((groupId) => [
        groupId,
        groupId === 103 || groupId === 109 ? "failed" : "success",
      ]),
    );
    assert.deepEqual(detail.attempts[1].totals, {
      failed: 0,
      success: 2,
      total: 2,
      unknown: 0,
      unreachable: 0,
    });
    assert.equal(detail.aggregate.total, 10);
    assert.equal(detail.aggregate.success, 10);
    assert.equal(detail.aggregate.failed, 0);
    assert.equal(detail.aggregate.unknown, 0);
    assert.equal(detail.aggregate.allSuccess, true);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
    assert.equal(detail.status, "sent");
    assert.equal((await maintenance.list()).length, 1);
  });

  it("replays the same receipt without enqueueing and rejects changed payloads", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-receipt-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));
    await maintenance.runOnce();
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    const input = { groupIds: preview.targetGroupIds, version: preview.version };

    const first = await maintenance.retry(
      created.notice.id,
      input,
      "retry-receipt-key",
    );
    assert.equal(first.created, true);

    const replay = await maintenance.retry(
      created.notice.id,
      input,
      "retry-receipt-key",
    );
    assert.equal(replay.created, false);
    assert.equal(replay.attemptId, first.attemptId);
    assert.equal(replay.notice.attemptCount, 2);
    assert.equal(upstream.requests.length, 1);

    await assert.rejects(
      maintenance.retry(
        created.notice.id,
        { groupIds: [103], version: input.version },
        "retry-receipt-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        return true;
      },
    );
    await assert.rejects(
      maintenance.retry(
        created.notice.id,
        { groupIds: [109, 103], version: input.version },
        "retry-receipt-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        return true;
      },
    );

    upstream.setHandler((request) =>
      upstreamResults(
        readJsonBody(request).group_ids.map((groupId) => resultEntry(groupId)),
      ),
    );
    await maintenance.runOnce();
    assert.equal(upstream.requests.length, 2);

    now += 31 * 24 * 60 * 60 * 1000;
    const completedReplay = await maintenance.retry(
      created.notice.id,
      input,
      "retry-receipt-key",
    );
    assert.equal(completedReplay.created, false);
    assert.equal(completedReplay.attemptId, first.attemptId);
    assert.equal(completedReplay.notice.attemptCount, 2);
    assert.equal(upstream.requests.length, 2);
  });

  it("allows only one of two simultaneous distinct keys with the same version", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-concurrent-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));
    await maintenance.runOnce();
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    const input = { groupIds: preview.targetGroupIds, version: preview.version };

    const results = await Promise.allSettled([
      maintenance.retry(created.notice.id, input, "retry-concurrent-a"),
      maintenance.retry(created.notice.id, input, "retry-concurrent-b"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(fulfilled[0].value.created, true);
    assert.equal(rejected[0].reason.name, "MaintenanceConflictError");

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 2);
    assert.equal(
      detail.attempts.filter((attempt) => attempt.number > 1).length,
      1,
    );
  });

  it("rejects stale versions, subsets, supersets, and reordered lists without enqueuing", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-stale-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));
    await maintenance.runOnce();
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);

    const invalidInputs = [
      { groupIds: [109, 103], version: preview.version },
      { groupIds: [103], version: preview.version },
      { groupIds: [103, 109, 102], version: preview.version },
      { groupIds: [103, 109], version: preview.version - 1 },
    ];

    for (const [index, input] of invalidInputs.entries()) {
      await assert.rejects(
        maintenance.retry(
          created.notice.id,
          input,
          `retry-stale-${index}`,
        ),
        (error) => {
          assert.equal(error.name, "MaintenanceConflictError");
          return true;
        },
      );
    }

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 1);

    const accepted = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-stale-accepted",
    );
    assert.equal(accepted.created, true);
    const after = await maintenance.get(created.notice.id);
    assert.ok(after);
    assert.equal(after.attempts.length, 2);
    assert.equal(after.version, preview.version + 1);
  });

  it("rejects retries when the notice is not sent, busy, or has no eligible target", async () => {
    const allSuccess = await maintenance.create(
      maintenanceInput({ groupIds: [304] }),
      "retry-blocked-success",
    );
    await maintenance.runOnce();
    const successPreview = await maintenance.previewRetry(allSuccess.notice.id);
    assert.ok(successPreview);
    assert.deepEqual(successPreview.targetGroupIds, []);
    await assert.rejects(
      maintenance.retry(
        allSuccess.notice.id,
        { groupIds: [304], version: successPreview.version },
        "retry-blocked-success-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        return true;
      },
    );

    const queued = await maintenance.create(
      maintenanceInput({ groupIds: [303] }),
      "retry-blocked-queued",
    );
    const queuedPreview = await maintenance.previewRetry(queued.notice.id);
    assert.ok(queuedPreview);
    assert.deepEqual(queuedPreview.targetGroupIds, []);
    await assert.rejects(
      maintenance.retry(
        queued.notice.id,
        { groupIds: [303], version: queuedPreview.version },
        "retry-blocked-queued-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        return true;
      },
    );

    await assert.rejects(
      maintenance.retry(
        "missing-notice",
        { groupIds: [101], version: 1 },
        "retry-missing-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceNotFoundError");
        return true;
      },
    );
  });

  it("conflicts when one submission key is reused for another notice", async () => {
    const first = await createAllFailedNotice([601], "retry-cross-notice-a");
    const second = await createAllFailedNotice([602], "retry-cross-notice-b");
    const firstPreview = await maintenance.previewRetry(
      first.created.notice.id,
    );
    const secondPreview = await maintenance.previewRetry(
      second.created.notice.id,
    );
    assert.ok(firstPreview);
    assert.ok(secondPreview);

    const accepted = await maintenance.retry(
      first.created.notice.id,
      { groupIds: firstPreview.targetGroupIds, version: firstPreview.version },
      "retry-cross-notice-key",
    );
    assert.equal(accepted.created, true);

    await assert.rejects(
      maintenance.retry(
        second.created.notice.id,
        {
          groupIds: secondPreview.targetGroupIds,
          version: secondPreview.version,
        },
        "retry-cross-notice-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        assert.match(error.message, /提交标识/);
        return true;
      },
    );

    const detail = await maintenance.get(second.created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 1);
  });

  it("issues a new request id for each successive manual retry", async () => {
    const seeded = await createAllFailedNotice([611, 612], "retry-successive-base");
    const firstPreview = await maintenance.previewRetry(
      seeded.created.notice.id,
    );
    assert.ok(firstPreview);
    const firstRetry = await maintenance.retry(
      seeded.created.notice.id,
      { groupIds: firstPreview.targetGroupIds, version: firstPreview.version },
      "retry-successive-a",
    );
    assert.equal(firstRetry.created, true);

    upstream.setHandler(() =>
      upstreamResults(
        firstPreview.targetGroupIds.map((groupId) =>
          resultEntry(groupId, {
            error: "平台拒绝发送",
            error_code: "send_failed",
            status: "failed",
            success: false,
          }),
        ),
      ),
    );
    now += 1_000;
    await maintenance.runOnce();

    const secondPreview = await maintenance.previewRetry(
      seeded.created.notice.id,
    );
    assert.ok(secondPreview);
    assert.deepEqual(secondPreview.targetGroupIds, [611, 612]);
    assert.notEqual(secondPreview.version, firstPreview.version);

    const secondRetry = await maintenance.retry(
      seeded.created.notice.id,
      { groupIds: secondPreview.targetGroupIds, version: secondPreview.version },
      "retry-successive-b",
    );
    assert.equal(secondRetry.created, true);
    assert.notEqual(secondRetry.attemptId, firstRetry.attemptId);

    upstream.setHandler((request) =>
      upstreamResults(
        readJsonBody(request).group_ids.map((groupId) => resultEntry(groupId)),
      ),
    );
    now += 1_000;
    await maintenance.runOnce();

    const detail = await maintenance.get(seeded.created.notice.id);
    assert.ok(detail);
    assert.deepEqual(
      detail.attempts.map((attempt) => attempt.number),
      [1, 2, 3],
    );
    assert.equal(
      new Set(detail.attempts.map((attempt) => attempt.requestId)).size,
      3,
    );
    assert.equal(upstream.requests.length, 3);
    for (const attempt of detail.attempts) {
      assert.match(attempt.requestId, /^maint-/);
      assert.equal(
        upstream.requests.some(
          (request) => request.headers["x-request-id"] === attempt.requestId,
        ),
        true,
        `missing upstream request for ${attempt.requestId}`,
      );
    }
  });

  it("creates a fresh request id for old local failures instead of replaying the old one", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-old-failure-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));
    await maintenance.runOnce();
    const oldRequestId = upstream.requests[0].headers["x-request-id"];

    now += 31 * 24 * 60 * 60 * 1000;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, [103, 109]);

    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-old-failure-key",
    );
    assert.equal(retry.created, true);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const newRequestId = detail.attempts[1].requestId;
    assert.match(newRequestId, /^maint-/);
    assert.notEqual(newRequestId, oldRequestId);

    upstream.setHandler((request) =>
      upstreamResults(
        readJsonBody(request).group_ids.map((groupId) => resultEntry(groupId)),
      ),
    );
    await maintenance.runOnce();
    assert.equal(upstream.requests.length, 2);
    assert.equal(upstream.requests[1].headers["x-request-id"], newRequestId);
    assert.deepEqual(readJsonBody(upstream.requests[1]).group_ids, [103, 109]);
  });
});

function eightSuccessTwoFailures(groupIds) {
  return upstreamResults(
    [...groupIds].reverse().map((groupId) =>
      groupId === 103 || groupId === 109
        ? resultEntry(groupId, {
            error: "平台拒绝发送",
            error_code: "send_failed",
            status: "failed",
            success: false,
          })
        : resultEntry(groupId),
    ),
  );
}

describe("manual retry dispatch and completion", () => {
  it("records a missing retry result only for the retry snapshot", async () => {
    const groupIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const created = await maintenance.create(
      maintenanceInput({ groupIds }),
      "retry-missing-base",
    );
    upstream.setHandler(() => eightSuccessTwoFailures(groupIds));
    await maintenance.runOnce();
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);

    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-missing-key",
    );
    assert.equal(retry.created, true);

    upstream.setHandler(() => upstreamResults([resultEntry(103)]));
    await maintenance.runOnce();

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const retryAttempt = detail.attempts[1];
    assert.deepEqual(
      retryAttempt.results.map((result) => [
        result.groupId,
        result.outcome,
        result.reason,
      ]),
      [
        [103, "success", "发送成功"],
        [109, "unknown", "上游未返回结果"],
      ],
    );
    assert.deepEqual(retryAttempt.totals, {
      failed: 0,
      success: 1,
      total: 2,
      unknown: 1,
      unreachable: 0,
    });
    assert.equal(detail.aggregate.total, 10);
    assert.equal(detail.aggregate.success, 9);
    assert.equal(detail.aggregate.unknown, 1);
    assert.equal(detail.aggregate.pending, 0);
    assert.equal(detail.aggregate.perGroup[2].outcome, "success");
    assert.equal(detail.aggregate.perGroup[8].outcome, "unknown");
    assert.equal(
      detail.attempts[0].results.length,
      10,
      "original attempt evidence is retained",
    );
  });

  it("keeps retry 409 and 429 attempts from resetting the retention anchor", async () => {
    const conflicts = await createAllFailedNotice([501, 502], "retry-409-base");
    const conflictAnchor = conflicts.anchor;
    now += 1_000;
    const conflictPreview = await maintenance.previewRetry(
      conflicts.created.notice.id,
    );
    assert.ok(conflictPreview);
    const conflictRetry = await maintenance.retry(
      conflicts.created.notice.id,
      {
        groupIds: conflictPreview.targetGroupIds,
        version: conflictPreview.version,
      },
      "retry-409-key",
    );

    upstream.setHandler(() => ({
      body: { detail: { message: "存在进行中的同名请求" } },
      status: 409,
    }));
    now += 1_000;
    await maintenance.runOnce();

    let detail = await maintenance.get(conflicts.created.notice.id);
    assert.ok(detail);
    let retryAttempt = detail.attempts[1];
    assert.equal(retryAttempt.id, conflictRetry.attemptId);
    assert.equal(retryAttempt.executed, false);
    assert.equal(retryAttempt.requiresReconciliation, true);
    assert.equal(retryAttempt.remainingSeconds, null);
    assert.equal(retryAttempt.requestError, "存在进行中的同名请求");
    assert.equal(detail.lastExecutedAttemptEndedAt, conflictAnchor);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [501, 502]);
    assert.equal(detail.aggregate.perGroup[0].outcome, "unknown");
    assert.equal(detail.aggregate.perGroup[1].outcome, "unknown");
    assert.equal(detail.aggregate.requiresReconciliation, true);

    const throttled = await createAllFailedNotice(
      [511, 512],
      "retry-429-base",
    );
    const throttleAnchor = throttled.anchor;
    now += 1_000;
    const throttlePreview = await maintenance.previewRetry(
      throttled.created.notice.id,
    );
    assert.ok(throttlePreview);
    const throttleRetry = await maintenance.retry(
      throttled.created.notice.id,
      {
        groupIds: throttlePreview.targetGroupIds,
        version: throttlePreview.version,
      },
      "retry-429-key",
    );

    upstream.setHandler(() => ({
      body: {
        detail: { message: "发送过于频繁", remaining_seconds: 12.5 },
      },
      status: 429,
    }));
    now += 1_000;
    await maintenance.runOnce();

    detail = await maintenance.get(throttled.created.notice.id);
    assert.ok(detail);
    retryAttempt = detail.attempts[1];
    assert.equal(retryAttempt.id, throttleRetry.attemptId);
    assert.equal(retryAttempt.executed, false);
    assert.equal(retryAttempt.requiresReconciliation, false);
    assert.equal(retryAttempt.remainingSeconds, 12.5);
    assert.equal(retryAttempt.requestError, "发送过于频繁");
    assert.deepEqual(retryAttempt.results, []);
    assert.equal(detail.lastExecutedAttemptEndedAt, throttleAnchor);
  });

  it("keeps body-read failures classified and refreshes the anchor on executed retries", async () => {
    const originalFetch = globalThis.fetch;
    const unreadableConflict = await createAllFailedNotice(
      [521, 522],
      "retry-body-409-base",
    );
    now += 1_000;
    let preview = await maintenance.previewRetry(
      unreadableConflict.created.notice.id,
    );
    assert.ok(preview);
    await maintenance.retry(
      unreadableConflict.created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-body-409-key",
    );

    try {
      globalThis.fetch = async () => failingBodyResponse(409);
      now += 1_000;
      await maintenance.runOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }

    let detail = await maintenance.get(unreadableConflict.created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[1].executed, false);
    assert.equal(detail.attempts[1].requiresReconciliation, true);
    assert.match(detail.attempts[1].requestError ?? "", /409/);
    assert.equal(
      detail.lastExecutedAttemptEndedAt,
      unreadableConflict.anchor,
    );

    const unreadableSuccess = await createAllFailedNotice(
      [531, 532],
      "retry-body-200-base",
    );
    now += 1_000;
    preview = await maintenance.previewRetry(
      unreadableSuccess.created.notice.id,
    );
    assert.ok(preview);
    await maintenance.retry(
      unreadableSuccess.created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-body-200-key",
    );
    let executedAt = 0;

    try {
      globalThis.fetch = async () => failingBodyResponse(200);
      now += 1_000;
      executedAt = now;
      await maintenance.runOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }

    detail = await maintenance.get(unreadableSuccess.created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[1].executed, true);
    assert.equal(detail.attempts[1].results[0].outcome, "unknown");
    assert.equal(detail.lastExecutedAttemptEndedAt, executedAt);

    const networkFailure = await createAllFailedNotice(
      [541, 542],
      "retry-network-base",
    );
    now += 1_000;
    const networkPreview = await maintenance.previewRetry(
      networkFailure.created.notice.id,
    );
    assert.ok(networkPreview);
    await maintenance.retry(
      networkFailure.created.notice.id,
      {
        groupIds: networkPreview.targetGroupIds,
        version: networkPreview.version,
      },
      "retry-network-key",
    );
    upstream.setHandler(() => ({ destroy: true }));
    now += 1_000;
    const networkExecutedAt = now;
    await maintenance.runOnce();
    detail = await maintenance.get(networkFailure.created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[1].executed, true);
    assert.equal(detail.attempts[1].results[0].reason, "上游未返回结果");
    assert.match(detail.attempts[1].requestError ?? "", /网络/);
    assert.equal(detail.lastExecutedAttemptEndedAt, networkExecutedAt);
  });

  it("executes a scheduled notice's retry after the original start window", async () => {
    const groupIds = [701, 702, 703];
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ groupIds, mode: "scheduled", plannedAt }),
      "retry-scheduled-window-base",
    );

    upstream.setHandler(() =>
      upstreamResults([
        resultEntry(701),
        resultEntry(702, {
          error: "平台拒绝发送",
          error_code: "send_failed",
          status: "failed",
          success: false,
        }),
        resultEntry(703, {
          error: "平台超时",
          error_code: "delivery_unknown",
          status: "failed",
          success: false,
        }),
      ]),
    );

    now = plannedAt;
    const firstRun = await maintenance.runOnce();
    assert.equal(firstRun.processed, true);
    const firstEndedAt = now;
    const afterFirst = await maintenance.get(created.notice.id);
    assert.ok(afterFirst);
    assert.equal(afterFirst.status, "sent");
    assert.deepEqual(
      afterFirst.aggregate.perGroup.map((target) => [
        target.groupId,
        target.outcome,
      ]),
      [
        [701, "success"],
        [702, "failed"],
        [703, "unknown"],
      ],
    );
    const firstAttempt = afterFirst.attempts[0];
    const firstBody = structuredClone(firstAttempt.requestBody);
    assert.deepEqual(firstAttempt.targetGroupIds, groupIds);
    assert.equal(
      firstAttempt.requestId,
      upstream.requests[0].headers["x-request-id"],
    );
    assert.deepEqual(readJsonBody(upstream.requests[0]), firstBody);

    now = plannedAt + 10 * 60_000;
    const idle = await maintenance.runOnce();
    assert.equal(idle.processed, false);
    assert.equal(upstream.requests.length, 1);

    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, [702]);
    assert.equal(preview.blockedReason, null);

    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: preview.targetGroupIds, version: preview.version },
      "retry-scheduled-window-key",
    );
    assert.equal(retry.created, true);
    assert.equal(retry.notice.attemptCount, 2);

    upstream.setHandler((request) =>
      upstreamResults(
        readJsonBody(request).group_ids.map((groupId) => resultEntry(groupId)),
      ),
    );
    const retryEndedAt = now;
    const secondRun = await maintenance.runOnce();
    assert.equal(secondRun.processed, true);
    assert.equal(secondRun.attemptId, retry.attemptId);

    assert.equal(upstream.requests.length, 2);
    assert.deepEqual(
      upstream.requests.map((request) => request.method),
      ["POST", "POST"],
    );
    const firstRequestId = upstream.requests[0].headers["x-request-id"];
    const secondRequestId = upstream.requests[1].headers["x-request-id"];
    assert.notEqual(secondRequestId, firstRequestId);
    assert.deepEqual(readJsonBody(upstream.requests[1]).group_ids, [702]);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.plannedAt, plannedAt);
    assert.equal(detail.attempts.length, 2);
    assert.equal(detail.attempts[0].requestId, firstRequestId);
    assert.equal(detail.attempts[0].endedAt, firstEndedAt);
    assert.deepEqual(detail.attempts[0].targetGroupIds, groupIds);
    assert.deepEqual(detail.attempts[0].requestBody, firstBody);
    assert.deepEqual(readJsonBody(upstream.requests[0]), firstBody);

    const retryAttempt = detail.attempts[1];
    assert.equal(retryAttempt.id, retry.attemptId);
    assert.equal(retryAttempt.requestId, secondRequestId);
    assert.equal(retryAttempt.number, 2);
    assert.equal(retryAttempt.phase, "completed");
    assert.equal(retryAttempt.executed, true);
    assert.equal(retryAttempt.endedAt, retryEndedAt);
    assert.deepEqual(retryAttempt.targetGroupIds, [702]);
    assert.deepEqual(retryAttempt.requestBody, {
      content: firstBody.content,
      group_ids: [702],
      scheduled_time: firstBody.scheduled_time,
      title: firstBody.title,
    });
    assert.deepEqual(
      retryAttempt.results.map((result) => [result.groupId, result.outcome]),
      [[702, "success"]],
    );
    assert.equal(detail.lastExecutedAttemptEndedAt, retryEndedAt);
    assert.deepEqual(
      detail.aggregate.perGroup.map((target) => [
        target.groupId,
        target.outcome,
      ]),
      [
        [701, "success"],
        [702, "success"],
        [703, "unknown"],
      ],
    );
    assert.equal(detail.aggregate.success, 2);
    assert.equal(detail.aggregate.failed, 0);
    assert.equal(detail.aggregate.unknown, 1);
    assert.equal(detail.aggregate.pending, 0);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [703]);

    const finalIdle = await maintenance.runOnce();
    assert.equal(finalIdle.processed, false);
    assert.equal(upstream.requests.length, 2);
    assert.equal((await maintenance.get(created.notice.id)).attempts.length, 2);
  });
});

async function createAllFailedNotice(groupIds, key) {
  const created = await maintenance.create(
    maintenanceInput({ groupIds }),
    key,
  );
  upstream.setHandler(() =>
    upstreamResults(
      groupIds.map((groupId) =>
        resultEntry(groupId, {
          error: "平台拒绝发送",
          error_code: "send_failed",
          status: "failed",
          success: false,
        }),
      ),
    ),
  );
  await maintenance.runOnce();
  const detail = await maintenance.get(created.notice.id);
  assert.ok(detail);
  assert.equal(detail.aggregate.failed, groupIds.length);

  return { anchor: detail.lastExecutedAttemptEndedAt, created };
}

function failingBodyResponse(status) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error("synthetic body stream failure"));
      },
    }),
    { status },
  );
}

function decodeAuditReason(header) {
  return new TextDecoder().decode(
    Uint8Array.from(String(header), (character) => character.charCodeAt(0)),
  );
}
