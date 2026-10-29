import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTempDatabase,
  loadMaintenanceModules,
  maintenanceInput,
  readDatabaseBytes,
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
  temp = await createTempDatabase();
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

describe("maintenance facade durable creation", () => {
  it("persists notice and queued attempt before any upstream request", async () => {
    const result = await maintenance.create(
      maintenanceInput(),
      "submission-key-1",
    );

    assert.equal(result.created, true);
    assert.equal(result.notice.status, "upcoming");
    assert.equal(result.notice.activity, "queued");
    assert.equal(result.notice.attemptCount, 1);
    assert.equal(result.notice.aggregate.pending, 2);
    assert.equal(result.notice.aggregate.allSuccess, false);
    assert.equal(result.notice.createdAt, now);
    assert.equal(result.notice.updatedAt, now);
    assert.equal(result.notice.version, 1);

    const detail = await maintenance.get(result.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 1);

    const [attempt] = detail.attempts;
    assert.equal(attempt.phase, "queued");
    assert.equal(attempt.executed, false);
    assert.equal(attempt.number, 1);
    assert.match(attempt.requestId, /^maint-[0-9a-f-]{36}$/);
    assert.equal(attempt.auditReason, "发送维护通知");
    assert.deepEqual(attempt.requestBody, {
      content: "预计维护 10 分钟\n期间可能出现短暂不可用",
      group_ids: [101, 202],
      scheduled_time: "2026-11-01 22:00 - 23:00",
      title: "Komari 服务维护通知",
    });
    assert.deepEqual(attempt.targetGroupIds, [101, 202]);
    assert.equal(attempt.totals.total, 2);
    assert.equal(attempt.totals.unknown, 0);
  });

  it("does not resolve upstream configuration for create, list, or get", async () => {
    let resolved = 0;
    const isolated = createService(temp.databasePath, () => now, () => {
      resolved += 1;
      throw new Error("upstream must not be resolved by HTTP operations");
    });

    const created = await isolated.create(maintenanceInput(), "no-upstream");
    const list = await isolated.list();
    const detail = await isolated.get(created.notice.id);

    assert.equal(created.created, true);
    assert.equal(list.length, 1);
    assert.equal(detail?.id, created.notice.id);
    assert.equal(resolved, 0);
  });

  it("returns the same notice and attempt for the same normalized submission", async () => {
    const first = await maintenance.create(
      maintenanceInput(),
      "retry-stable-key",
    );
    now += 5_000;
    const replay = await maintenance.create(
      maintenanceInput({
        content: "  预计维护 10 分钟\n期间可能出现短暂不可用  ",
        title: " Komari 服务维护通知 ",
      }),
      "retry-stable-key",
    );

    assert.equal(replay.created, false);
    assert.equal(replay.notice.id, first.notice.id);
    assert.equal(replay.notice.attemptCount, 1);
    assert.equal(replay.notice.createdAt, first.notice.createdAt);
    assert.equal(replay.notice.updatedAt, first.notice.updatedAt);

    const detail = await maintenance.get(first.notice.id);
    assert.equal(detail?.attempts.length, 1);
  });

  it("rejects the same submission key with different normalized input", async () => {
    await maintenance.create(maintenanceInput(), "conflicting-key");

    await assert.rejects(
      maintenance.create(
        maintenanceInput({ groupIds: [101, 303] }),
        "conflicting-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        assert.match(error.message, /提交标识/);
        return true;
      },
    );
  });

  it("keeps a never-submitted queued submission replayable beyond 30 days", async () => {
    const first = await maintenance.create(
      maintenanceInput(),
      "long-queued-key",
    );
    now += 31 * 24 * 60 * 60 * 1000;

    const replay = await maintenance.create(
      maintenanceInput(),
      "long-queued-key",
    );

    assert.equal(replay.created, false);
    assert.equal(replay.notice.id, first.notice.id);
    assert.equal(replay.notice.attemptCount, 1);
  });

  it("lets an independently opened service read the same history", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [7] }),
      "independent-key",
    );
    const independent = createService(temp.databasePath, () => now);

    const list = await independent.list();
    const detail = await independent.get(created.notice.id);

    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.notice.id);
    assert.equal(list[0].aggregate.pending, 1);
    assert.equal(detail?.attempts.length, 1);
    assert.match(detail.attempts[0].requestId, /^maint-/);
  });

  it("returns null for an unknown notice id", async () => {
    assert.equal(await maintenance.get("missing-notice"), null);
  });
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


describe("maintenance dispatch and evidence", () => {
  it("sends one persisted attempt to the v2 endpoint with audit headers and the exact body", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [11, 22] }),
      "dispatch-key",
    );
    assert.equal(upstream.requests.length, 0);

    now += 1_000;
    const run = await maintenance.runOnce();

    assert.equal(run.processed, true);
    assert.equal(run.noticeId, created.notice.id);
    assert.equal(upstream.requests.length, 1);

    const request = upstream.requests[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/v2/komari-announce/maintenance");
    assert.equal(
      request.headers.authorization,
      `Bearer ${TEST_BACKEND_TOKEN}`,
    );
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(
      decodeAuditReason(request.headers["x-komari-change-reason"]),
      "发送维护通知",
    );
    assert.deepEqual(Object.keys(readJsonBody(request)).sort(), [
      "content",
      "group_ids",
      "scheduled_time",
      "title",
    ]);
    assert.deepEqual(readJsonBody(request), {
      content: "预计维护 10 分钟\n期间可能出现短暂不可用",
      group_ids: [11, 22],
      scheduled_time: "2026-11-01 22:00 - 23:00",
      title: "Komari 服务维护通知",
    });

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(request.headers["x-request-id"], detail.attempts[0].requestId);
    assert.match(request.headers["x-request-id"], /^maint-[0-9a-f-]{36}$/);
    assert.equal(detail.status, "sent");
    assert.equal(detail.activity, null);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].startedAt, now);
    assert.equal(detail.attempts[0].endedAt, now);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
    assert.deepEqual(detail.aggregate.perGroup, [
      {
        groupId: 11,
        outcome: "success",
        reason: "发送成功",
        retryBlocked: false,
        requiresReconciliation: false,
      },
      {
        groupId: 22,
        outcome: "success",
        reason: "发送成功",
        retryBlocked: false,
        requiresReconciliation: false,
      },
    ]);
    assert.equal(detail.aggregate.allSuccess, true);
    assert.deepEqual(detail.attempts[0].totals, {
      total: 2,
      success: 2,
      failed: 0,
      unreachable: 0,
      unknown: 0,
    });
    assert.equal(
      readDatabaseBytes(temp.databasePath).includes(
        Buffer.from(TEST_BACKEND_TOKEN),
      ),
      false,
    );
  });

  it("does not send a second time for a completed attempt", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [5] }),
      "single-send-key",
    );
    await maintenance.runOnce();
    const second = await maintenance.runOnce();

    assert.equal(second.processed, false);
    assert.equal(upstream.requests.length, 1);
    const detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.attempts.length, 1);
  });

  it("returns the existing local submission after 30+ days without replaying upstream", async () => {
    const first = await maintenance.create(
      maintenanceInput(),
      "submitted-long-lived-key",
    );
    await maintenance.runOnce();
    assert.equal(upstream.requests.length, 1);
    now += 31 * 24 * 60 * 60 * 1000;

    const replay = await maintenance.create(
      maintenanceInput(),
      "submitted-long-lived-key",
    );

    assert.equal(replay.created, false);
    assert.equal(replay.notice.id, first.notice.id);
    assert.equal(replay.notice.attemptCount, 1);
    assert.equal(replay.notice.status, "sent");
    assert.equal(upstream.requests.length, 1);

    const detail = await maintenance.get(first.notice.id);
    assert.equal(detail?.attempts.length, 1);
    assert.equal(detail?.attempts[0].executed, true);
  });

  it("normalizes mixed, missing, and extra upstream results without trusting aggregate counts", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [1, 2, 3, 4, 5] }),
      "mixed-results-key",
    );
    upstream.setHandler((request) => {
      const body = readJsonBody(request);
      assert.deepEqual(body.group_ids, [1, 2, 3, 4, 5]);

      return {
        body: {
          results: [
            {
              bot_id: "bot-1",
              error: null,
              error_code: null,
              group_id: 1,
              status: "success",
              success: true,
            },
            {
              bot_id: "bot-2",
              error: "敏感词拦截",
              error_code: "send_failed",
              group_id: 2,
              status: "failed",
              success: false,
            },
            {
              bot_id: null,
              error: "bot 未入群",
              error_code: "group_unreachable",
              group_id: 3,
              status: "unreachable",
              success: false,
            },
            {
              bot_id: "bot-4",
              error: "平台超时",
              error_code: "delivery_unknown",
              group_id: 4,
              status: "failed",
              success: false,
            },
            {
              bot_id: "bot-99",
              error: null,
              error_code: null,
              group_id: 99,
              status: "success",
              success: true,
            },
          ],
          failed_count: 0,
          success_count: 5,
          total: 5,
          unavailable_bot_count: 0,
          unreachable_count: 0,
        },
      };
    });

    const run = await maintenance.runOnce();
    assert.equal(run.processed, true);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];
    assert.deepEqual(
      attempt.results.map((result) => [
        result.groupId,
        result.outcome,
        result.reason,
      ]),
      [
        [1, "success", "发送成功"],
        [2, "failed", "发送失败"],
        [3, "unreachable", "未调用平台发送"],
        [4, "unknown", "投递结果未知，需人工核对"],
        [5, "unknown", "上游未返回结果"],
      ],
    );
    assert.equal(attempt.results[1].errorCode, "send_failed");
    assert.equal(attempt.results[1].error, "敏感词拦截");
    assert.equal(attempt.results[3].botId, "bot-4");
    assert.deepEqual(attempt.totals, {
      total: 5,
      success: 1,
      failed: 1,
      unreachable: 1,
      unknown: 2,
    });
    assert.equal(detail.aggregate.success, 1);
    assert.equal(detail.aggregate.failed, 1);
    assert.equal(detail.aggregate.unreachable, 1);
    assert.equal(detail.aggregate.unknown, 2);
    assert.equal(detail.aggregate.allSuccess, false);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [4, 5]);
    assert.equal(detail.aggregate.requiresReconciliation, true);
  });

  it("never treats an invalid or unrecognized error_code as verified success", async () => {
    const invalidCodes = [
      123,
      { code: "send_failed" },
      true,
      "   ",
      " unexpected_code ",
      "unexpected_code",
    ];

    for (const [index, errorCode] of invalidCodes.entries()) {
      const groupId = 710 + index;
      const created = await maintenance.create(
        maintenanceInput({ groupIds: [groupId] }),
        `invalid-error-code-${index}`,
      );
      upstream.setHandler(() => ({
        body: {
          results: [
            {
              bot_id: "bot-invalid-code",
              error: null,
              error_code: errorCode,
              group_id: groupId,
              status: "success",
              success: true,
            },
          ],
          success_count: 1,
          total: 1,
        },
      }));

      await maintenance.runOnce();
      const detail = await maintenance.get(created.notice.id);
      assert.ok(detail, `missing detail for ${index}`);

      assert.equal(
        detail.attempts[0].results[0].outcome,
        "unknown",
        `outcome for ${JSON.stringify(errorCode)}`,
      );
      assert.equal(
        detail.attempts[0].results[0].requiresReconciliation,
        true,
        `reconciliation for ${JSON.stringify(errorCode)}`,
      );
      assert.equal(detail.aggregate.allSuccess, false);
      assert.equal(detail.aggregate.success, 0);
      assert.equal(detail.aggregate.unknown, 1);
      assert.equal(detail.aggregate.requiresReconciliation, true);
      assert.deepEqual(detail.aggregate.blockedGroupIds, [groupId]);
    }

    const validNull = await maintenance.create(
      maintenanceInput({ groupIds: [720] }),
      "valid-null-error-code",
    );
    upstream.setHandler(() => ({
      body: {
        results: [
          {
            bot_id: "bot-valid",
            error: null,
            error_code: null,
            group_id: 720,
            status: "success",
            success: true,
          },
        ],
      },
    }));
    await maintenance.runOnce();
    const validDetail = await maintenance.get(validNull.notice.id);
    assert.ok(validDetail);
    assert.equal(validDetail.attempts[0].results[0].outcome, "success");
    assert.equal(validDetail.aggregate.allSuccess, true);

    const validAbsent = await maintenance.create(
      maintenanceInput({ groupIds: [721] }),
      "valid-absent-error-code",
    );
    upstream.setHandler(() => ({
      body: {
        results: [
          {
            bot_id: "bot-valid-absent",
            error: null,
            group_id: 721,
            status: "success",
            success: true,
          },
        ],
      },
    }));
    await maintenance.runOnce();
    const absentDetail = await maintenance.get(validAbsent.notice.id);
    assert.ok(absentDetail);
    assert.equal(
      absentDetail.attempts[0].results[0].outcome,
      "success",
    );
  });

  it("keeps contradictory and duplicate upstream evidence unknown and never retry-eligible", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [7, 8] }),
      "contradictory-key",
    );
    upstream.setHandler(() => ({
      body: {
        results: [
          {
            bot_id: "bot-7",
            error: "failed",
            error_code: "send_failed",
            group_id: 7,
            status: "success",
            success: true,
          },
          {
            bot_id: "bot-8a",
            error: null,
            error_code: null,
            group_id: 8,
            status: "success",
            success: true,
          },
          {
            bot_id: "bot-8b",
            error: null,
            error_code: null,
            group_id: 8,
            status: "success",
            success: true,
          },
        ],
        success_count: 2,
        total: 2,
      },
    }));

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);

    assert.deepEqual(
      detail.attempts[0].results.map((result) => [
        result.groupId,
        result.outcome,
        result.reason,
      ]),
      [
        [7, "unknown", "上游结果矛盾，结果未知"],
        [8, "unknown", "上游结果重复，结果未知"],
      ],
    );
    assert.deepEqual(detail.aggregate.blockedGroupIds, [7, 8]);
    assert.equal(detail.aggregate.allSuccess, false);
  });

  it("preserves known HTTP status when the response body stream fails", async () => {
    const cases = [
      {
        expected: { executed: false, requiresReconciliation: true },
        status: 409,
      },
      {
        expected: { executed: false, requiresReconciliation: false },
        status: 429,
      },
      {
        expected: { executed: false, requiresReconciliation: false },
        status: 422,
      },
    ];
    const originalFetch = globalThis.fetch;

    try {
      for (const { expected, status } of cases) {
        const created = await maintenance.create(
          maintenanceInput({ groupIds: [600 + status] }),
          `body-read-failure-${status}`,
        );
        globalThis.fetch = async () => failingBodyResponse(status);

        await maintenance.runOnce();
        const detail = await maintenance.get(created.notice.id);
        assert.ok(detail, `missing detail for ${status}`);
        const attempt = detail.attempts[0];

        assert.equal(
          attempt.executed,
          expected.executed,
          `executed for ${status}`,
        );
        assert.equal(
          attempt.requiresReconciliation,
          expected.requiresReconciliation,
          `reconciliation for ${status}`,
        );
        assert.equal(
          detail.lastExecutedAttemptEndedAt,
          null,
          `retention anchor for ${status}`,
        );
        assert.equal(attempt.remainingSeconds, null);
        assert.equal(attempt.phase, "completed");
        assert.match(attempt.requestError, new RegExp(String(status)));

        if (status === 409) {
          assert.deepEqual(detail.aggregate.blockedGroupIds, [600 + status]);
          assert.match(attempt.results[0].reason, /需人工核对/);
        } else {
          assert.deepEqual(detail.aggregate.blockedGroupIds, []);
          assert.equal(detail.aggregate.perGroup[0].outcome, "unknown");
          assert.match(
            detail.aggregate.perGroup[0].reason,
            new RegExp(String(status)),
          );
        }
      }

      const serverError = await maintenance.create(
        maintenanceInput({ groupIds: [650] }),
        "body-read-failure-500",
      );
      globalThis.fetch = async () => failingBodyResponse(500);
      await maintenance.runOnce();
      const errorDetail = await maintenance.get(serverError.notice.id);
      assert.ok(errorDetail);
      assert.equal(errorDetail.attempts[0].executed, true);
      assert.equal(errorDetail.attempts[0].results[0].outcome, "unknown");
      assert.equal(errorDetail.lastExecutedAttemptEndedAt, now);

      const successStatus = await maintenance.create(
        maintenanceInput({ groupIds: [651] }),
        "body-read-failure-200",
      );
      globalThis.fetch = async () => failingBodyResponse(200);
      await maintenance.runOnce();
      const successDetail = await maintenance.get(
        successStatus.notice.id,
      );
      assert.ok(successDetail);
      assert.equal(successDetail.attempts[0].executed, true);
      assert.equal(successDetail.attempts[0].results[0].outcome, "unknown");
      assert.equal(successDetail.lastExecutedAttemptEndedAt, now);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not follow an upstream redirect with a second POST", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [660] }),
      "redirect-refusal-key",
    );
    upstream.setHandler(() => ({
      body: "",
      headers: { location: "/redirected-maintenance" },
      status: 307,
    }));

    await maintenance.runOnce();

    assert.equal(upstream.requests.length, 1);
    assert.equal(
      upstream.requests[0].url,
      "/api/v2/komari-announce/maintenance",
    );
    assert.equal(
      upstream.requests.some((request) =>
        request.url.includes("redirected-maintenance"),
      ),
      false,
    );

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];
    assert.equal(attempt.executed, true);
    assert.equal(attempt.results[0].outcome, "unknown");
    assert.deepEqual(detail.aggregate.blockedGroupIds, [660]);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
  });

  it("records an upstream 409 as a reconciliation-required rejection without automatic resend", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [31, 32] }),
      "conflict-409-key",
    );
    upstream.setHandler(() => ({
      body: { detail: "存在进行中的同名维护请求" },
      status: 409,
    }));

    now += 500;
    const run = await maintenance.runOnce();

    assert.equal(run.processed, true);
    assert.equal(upstream.requests.length, 1);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];
    assert.equal(attempt.executed, false);
    assert.equal(attempt.requestError, "存在进行中的同名维护请求");
    assert.equal(attempt.remainingSeconds, null);
    assert.equal(attempt.requiresReconciliation, true);
    assert.equal(attempt.endedAt, now);
    assert.deepEqual(
      attempt.results.map((result) => result.outcome),
      ["unknown", "unknown"],
    );
    assert.match(attempt.results[0].reason, /存在进行中的同名维护请求/);
    assert.deepEqual(attempt.totals, {
      total: 2,
      success: 0,
      failed: 0,
      unreachable: 0,
      unknown: 2,
    });
    assert.equal(detail.lastExecutedAttemptEndedAt, null);
    assert.equal(detail.aggregate.unknown, 2);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [31, 32]);
    assert.equal(detail.aggregate.requiresReconciliation, true);
    assert.equal(detail.aggregate.allSuccess, false);

    const again = await maintenance.runOnce();
    assert.equal(again.processed, false);
    assert.equal(upstream.requests.length, 1);
  });

  it("treats a 409 with an unreadable body as reconciliation-required, not executed", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [33] }),
      "conflict-409-invalid-body-key",
    );
    upstream.setHandler(() => ({ body: "conflict", status: 409 }));

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];

    assert.equal(attempt.executed, false);
    assert.match(attempt.requestError, /409/);
    assert.equal(attempt.requiresReconciliation, true);
    assert.equal(detail.lastExecutedAttemptEndedAt, null);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [33]);
    assert.equal(detail.aggregate.allSuccess, false);
  });

  it("exposes a 429 cooldown without blocking or automatically retrying", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [41] }),
      "throttle-429-key",
    );
    upstream.setHandler(() => ({
      body: {
        detail: { message: "发送过于频繁", remaining_seconds: 12.5 },
      },
      status: 429,
    }));

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];

    assert.equal(attempt.executed, false);
    assert.equal(attempt.requestError, "发送过于频繁");
    assert.equal(attempt.remainingSeconds, 12.5);
    assert.equal(attempt.requiresReconciliation, false);
    assert.equal(detail.aggregate.perGroup[0].outcome, "unknown");
    assert.match(detail.aggregate.perGroup[0].reason, /剩余冷却 12.5 秒/);
    assert.deepEqual(detail.aggregate.blockedGroupIds, []);
    assert.equal(detail.aggregate.requiresReconciliation, false);
    assert.equal(detail.lastExecutedAttemptEndedAt, null);

    assert.equal((await maintenance.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 1);
  });

  it("preserves ordinary 4xx validation detail as request-level evidence", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [51] }),
      "invalid-422-key",
    );
    upstream.setHandler(() => ({
      body: { detail: [{ msg: "group_ids 超出运行上限" }] },
      status: 422,
    }));

    await maintenance.runOnce();
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    const attempt = detail.attempts[0];

    assert.equal(attempt.executed, false);
    assert.equal(attempt.requestError, "group_ids 超出运行上限");
    assert.deepEqual(attempt.results, []);
    assert.deepEqual(detail.aggregate.blockedGroupIds, []);
    assert.equal(detail.aggregate.perGroup[0].outcome, "unknown");
    assert.match(detail.aggregate.perGroup[0].reason, /group_ids 超出运行上限/);
  });

  it("treats 5xx and network failures as executed attempts with unknown evidence", async () => {
    const first = await maintenance.create(
      maintenanceInput({ groupIds: [61] }),
      "server-error-key",
    );
    upstream.setHandler(() => ({
      body: { detail: "内部错误不得泄露 synthetic-token" },
      status: 503,
    }));

    await maintenance.runOnce();
    let detail = await maintenance.get(first.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].results[0].reason, "上游未返回结果");
    assert.match(detail.attempts[0].requestError, /503/);
    assert.equal(detail.attempts[0].requestError.includes("synthetic-token"), false);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
    assert.equal(detail.aggregate.allSuccess, false);

    const second = await maintenance.create(
      maintenanceInput({ groupIds: [62] }),
      "network-error-key",
    );
    upstream.setHandler(() => ({ destroy: true }));

    await maintenance.runOnce();
    detail = await maintenance.get(second.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].results[0].reason, "上游未返回结果");
    assert.match(detail.attempts[0].requestError, /网络/);
    assert.deepEqual(detail.aggregate.blockedGroupIds, [62]);
  });

  it("treats invalid 200 responses as executed unknown attempts", async () => {
    const invalidJson = await maintenance.create(
      maintenanceInput({ groupIds: [71] }),
      "invalid-json-key",
    );
    upstream.setHandler(() => ({ body: "not-json", status: 200 }));

    await maintenance.runOnce();
    let detail = await maintenance.get(invalidJson.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].results[0].reason, "上游未返回结果");
    assert.match(detail.attempts[0].requestError, /不是有效 JSON/);
    assert.equal(detail.aggregate.allSuccess, false);

    const invalidShape = await maintenance.create(
      maintenanceInput({ groupIds: [72] }),
      "invalid-shape-key",
    );
    upstream.setHandler(() => ({
      body: { results: "not-an-array", success_count: 1, total: 1 },
      status: 200,
    }));

    await maintenance.runOnce();
    detail = await maintenance.get(invalidShape.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].results[0].reason, "上游未返回结果");
    assert.match(detail.attempts[0].requestError, /格式无效/);
    assert.equal(detail.aggregate.allSuccess, false);
  });

  it("publishes the claim before network I/O and shows running activity", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [91] }),
      "running-activity-key",
    );
    let releaseRequest;
    const gate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    upstream.setHandler(async (request) => {
      await gate;

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });

    const pendingRun = maintenance.runOnce();
    await waitFor(() => upstream.requests.length === 1);

    const during = await maintenance.get(created.notice.id);
    assert.ok(during);
    assert.equal(during.status, "sent");
    assert.equal(during.activity, "running");
    assert.equal(during.attempts[0].phase, "running");
    assert.equal(during.attempts[0].executed, false);
    assert.equal(during.attempts[0].startedAt, now);
    assert.equal(during.aggregate.pending, 1);

    releaseRequest();
    await pendingRun;

    const after = await maintenance.get(created.notice.id);
    assert.equal(after?.activity, null);
    assert.equal(after?.attempts[0].phase, "completed");
  });

  it("sorts upcoming work ascending and history by latest execution descending", async () => {
    now = 1_800_000_000_000;
    const first = await maintenance.create(
      maintenanceInput({ groupIds: [1] }),
      "sort-first-key",
    );
    now += 1_000;
    const second = await maintenance.create(
      maintenanceInput({ groupIds: [2] }),
      "sort-second-key",
    );
    now += 1_000;
    const third = await maintenance.create(
      maintenanceInput({ groupIds: [3] }),
      "sort-third-key",
    );

    await maintenance.runOnce();
    now += 1_000;
    await maintenance.runOnce();

    const list = await maintenance.list();
    assert.deepEqual(
      list.map((notice) => notice.id),
      [third.notice.id, second.notice.id, first.notice.id],
    );
    assert.equal(list[0].status, "upcoming");
    assert.equal(list[1].status, "sent");
    assert.equal(list[2].status, "sent");
    assert.ok(
      list[1].lastExecutedAttemptEndedAt >= list[2].lastExecutedAttemptEndedAt,
    );
  });

  it("allows only one of two concurrent services to dispatch an attempt", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [81, 82] }),
      "concurrent-key",
    );
    upstream.setHandler(async (request) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });
    const other = createService(temp.databasePath, () => now);

    const results = await Promise.all([
      maintenance.runOnce(),
      other.runOnce(),
    ]);

    assert.equal(upstream.requests.length, 1);
    assert.equal(results.filter((result) => result.processed).length, 1);
    const detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.attempts.length, 1);
    assert.equal(detail?.attempts[0].phase, "completed");
  });
});

function decodeAuditReason(header) {
  return new TextDecoder().decode(
    Uint8Array.from(String(header), (character) => character.charCodeAt(0)),
  );
}


async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("等待条件超时。");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
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
