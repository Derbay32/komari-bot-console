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
  temp = await createTempDatabase("maintenance-edit-service-");
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

function updatePayload(patch = {}) {
  return { ...maintenanceInput(patch), version: 1, ...patch };
}

async function expectInputError(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "MaintenanceInputError");
    if (pattern) {
      assert.match(error.message, pattern);
    }
    return true;
  });
}

async function expectConflict(promise, expected = {}) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, "MaintenanceConflictError");
    assert.ok(error.currentNotice, "conflict must carry the current notice");
    if (expected.status) {
      assert.equal(error.currentNotice.status, expected.status);
    }
    if (expected.activity !== undefined) {
      assert.equal(error.currentNotice.activity, expected.activity);
    }
    if (expected.version !== undefined) {
      assert.equal(error.currentNotice.version, expected.version);
    }
    if (expected.versionAtLeast !== undefined) {
      assert.ok(
        error.currentNotice.version >= expected.versionAtLeast,
        `version ${error.currentNotice.version} < ${expected.versionAtLeast}`,
      );
    }
    return true;
  });
}

describe("maintenance facade update", () => {
  it("updates every editable field on the same durable request and only sends the new snapshot", async () => {
    const originalPlannedAt = now + 10 * 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: originalPlannedAt }),
      "edit-every-field",
    );
    const before = await maintenance.get(created.notice.id);
    assert.ok(before);

    now += 1_000;
    const editedPlannedAt = now + 20 * 60_000;
    const updated = await maintenance.update(created.notice.id, {
      ...maintenanceInput({
        content: "新版正文\n第二行内容",
        groupIds: [303, 404],
        maintenanceTime: "2026-12-01 10:00 - 11:00",
        mode: "scheduled",
        plannedAt: editedPlannedAt,
        title: "新版维护标题",
      }),
      version: 1,
    });

    assert.ok(updated);
    assert.equal(updated.id, created.notice.id);
    assert.equal(updated.title, "新版维护标题");
    assert.equal(updated.content, "新版正文\n第二行内容");
    assert.equal(updated.maintenanceTime, "2026-12-01 10:00 - 11:00");
    assert.deepEqual(updated.groupIds, [303, 404]);
    assert.equal(updated.mode, "scheduled");
    assert.equal(updated.plannedAt, editedPlannedAt);
    assert.equal(updated.status, "upcoming");
    assert.equal(updated.activity, "queued");
    assert.equal(updated.version, 2);
    assert.equal(updated.createdAt, before.createdAt);
    assert.equal(updated.updatedAt, now);
    assert.equal(updated.endedAt, null);
    assert.equal(updated.startedAt, null);
    assert.equal(updated.lastExecutedAttemptEndedAt, null);
    assert.equal(updated.attemptCount, 1);
    assert.equal(upstream.requests.length, 0);

    const after = await maintenance.get(created.notice.id);
    assert.ok(after);
    assert.equal(after.attempts.length, 1);
    assert.equal(after.attempts[0].id, before.attempts[0].id);
    assert.equal(after.attempts[0].requestId, before.attempts[0].requestId);
    assert.equal(after.attempts[0].number, 1);
    assert.equal(after.attempts[0].phase, "queued");
    assert.equal(after.attempts[0].executed, false);
    assert.equal(after.attempts[0].auditReason, before.attempts[0].auditReason);
    assert.deepEqual(after.attempts[0].targetGroupIds, [303, 404]);
    assert.deepEqual(after.attempts[0].requestBody, {
      content: "新版正文\n第二行内容",
      group_ids: [303, 404],
      scheduled_time: "2026-12-01 10:00 - 11:00",
      title: "新版维护标题",
    });

    now = originalPlannedAt;
    assert.equal((await maintenance.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 0);

    now = editedPlannedAt;
    const run = await maintenance.runOnce();
    assert.equal(run.processed, true);
    assert.equal(upstream.requests.length, 1);
    const sent = readJsonBody(upstream.requests[0]);
    assert.deepEqual(sent, {
      content: "新版正文\n第二行内容",
      group_ids: [303, 404],
      scheduled_time: "2026-12-01 10:00 - 11:00",
      title: "新版维护标题",
    });
    assert.equal(
      upstream.requests[0].url,
      "/api/v2/komari-announce/maintenance",
    );

    const sentDetail = await maintenance.get(created.notice.id);
    assert.equal(sentDetail?.status, "sent");
    assert.equal(sentDetail?.attempts.length, 1);
    assert.equal(sentDetail?.attempts[0].id, before.attempts[0].id);
    assert.equal(
      sentDetail?.attempts[0].requestId,
      before.attempts[0].requestId,
    );
  });

  it("rejects unknown fields, strict version violations, and invalid form values without changing the task", async () => {
    const created = await maintenance.create(
      maintenanceInput(),
      "edit-invalid-input",
    );
    const before = await maintenance.get(created.notice.id);

    const invalidPayloads = [
      { ...updatePayload(), extra: true },
      { ...updatePayload(), version: undefined },
      updatePayload({ version: 0 }),
      updatePayload({ version: -1 }),
      updatePayload({ version: 1.5 }),
      updatePayload({ version: "1" }),
      updatePayload({ version: Number.MAX_SAFE_INTEGER + 1 }),
      updatePayload({ version: Number.NaN }),
      updatePayload({ title: "   " }),
      updatePayload({ title: "维".repeat(129) }),
      updatePayload({ content: "护".repeat(3001) }),
      updatePayload({ groupIds: [] }),
      updatePayload({ groupIds: [1, 1] }),
      updatePayload({
        groupIds: Array.from({ length: 101 }, (_, index) => index + 1),
      }),
      updatePayload({ mode: "later", plannedAt: 1_793_543_400_000 }),
      updatePayload({ mode: "immediate", plannedAt: 1_793_543_400_000 }),
      updatePayload({ mode: "scheduled", plannedAt: null }),
      updatePayload({ mode: "scheduled", plannedAt: "1793543400000" }),
    ];

    for (const payload of invalidPayloads) {
      await expectInputError(maintenance.update(created.notice.id, payload));
    }

    const after = await maintenance.get(created.notice.id);
    assert.ok(after);
    assert.equal(after.version, before.version);
    assert.equal(after.title, before.title);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.deepEqual(
      after.attempts[0].requestBody,
      before.attempts[0].requestBody,
    );
    assert.deepEqual(
      after.attempts[0].targetGroupIds,
      before.attempts[0].targetGroupIds,
    );

    assert.equal(await maintenance.update("missing-notice", updatePayload()), null);
  });

  it("keeps the verified 128/3000 text budgets and 100 group limit usable at the boundary", async () => {
    const created = await maintenance.create(
      maintenanceInput(),
      "edit-budget-boundary",
    );
    const boundary = await maintenance.update(created.notice.id, {
      ...maintenanceInput({
        content: "护".repeat(3000),
        groupIds: Array.from({ length: 100 }, (_, index) => index + 1),
        title: "维".repeat(128),
      }),
      version: 1,
    });

    assert.ok(boundary);
    assert.equal(boundary.version, 2);
    assert.equal(boundary.title.length, 128);
    assert.equal(boundary.content.length, 3000);
    assert.equal(boundary.groupIds.length, 100);
    const detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.attempts[0].requestBody.title.length, 128);
    assert.equal(detail?.attempts[0].requestBody.content.length, 3000);
    assert.equal(detail?.attempts[0].requestBody.group_ids.length, 100);
  });

  it("checks a new scheduled plan against the clock inside the write path and leaves rejected edits untouched", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "edit-clock-boundary",
    );

    now = plannedAt;
    await expectInputError(
      maintenance.update(created.notice.id, {
        ...maintenanceInput({ mode: "scheduled", plannedAt: now }),
        version: 1,
      }),
      /计划发送时间/,
    );

    now = plannedAt + 1_000;
    await expectInputError(
      maintenance.update(created.notice.id, {
        ...maintenanceInput({ mode: "scheduled", plannedAt: plannedAt - 1 }),
        version: 1,
      }),
      /计划发送时间/,
    );

    let detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.version, 1);
    assert.equal(detail.updatedAt, created.notice.updatedAt);
    assert.equal(detail.title, created.notice.title);
    assert.equal(detail.plannedAt, plannedAt);

    now = plannedAt - 1;
    const updated = await maintenance.update(created.notice.id, {
      ...maintenanceInput({
        content: "更新后的正文",
        mode: "scheduled",
        plannedAt,
        title: "更新后的标题",
      }),
      version: 1,
    });
    assert.ok(updated);
    assert.equal(updated.version, 2);
    assert.equal(updated.plannedAt, plannedAt);
    assert.equal(updated.updatedAt, now);

    detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.attempts[0].requestBody.title, "更新后的标题");
    assert.equal(detail?.attempts[0].requestBody.content, "更新后的正文");
  });

  it("allows switching between immediate and scheduled form semantics without a new attempt", async () => {
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 60_000 }),
      "edit-mode-switch",
    );

    const toImmediate = await maintenance.update(created.notice.id, {
      ...maintenanceInput({ mode: "immediate", plannedAt: null }),
      version: 1,
    });
    assert.ok(toImmediate);
    assert.equal(toImmediate.mode, "immediate");
    assert.equal(toImmediate.plannedAt, null);
    assert.equal(toImmediate.attemptCount, 1);

    now += 1_000;
    const toScheduled = await maintenance.update(created.notice.id, {
      ...maintenanceInput({
        mode: "scheduled",
        plannedAt: now + 60_000,
      }),
      version: 2,
    });
    assert.ok(toScheduled);
    assert.equal(toScheduled.mode, "scheduled");
    assert.equal(toScheduled.plannedAt, now + 60_000);
    assert.equal(toScheduled.attemptCount, 1);

    assert.equal(upstream.requests.length, 0);
  });
});

describe("maintenance facade cancel", () => {
  it("cancels a queued notice once, closes the attempt without results, and never calls upstream", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [101, 202] }),
      "cancel-basic",
    );
    const before = await maintenance.get(created.notice.id);
    assert.ok(before);

    now += 750;
    const canceled = await maintenance.cancel(created.notice.id, { version: 1 });
    assert.ok(canceled);
    assert.equal(canceled.id, created.notice.id);
    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.activity, null);
    assert.equal(canceled.endedAt, now);
    assert.equal(canceled.updatedAt, now);
    assert.equal(canceled.startedAt, null);
    assert.equal(canceled.lastExecutedAttemptEndedAt, null);
    assert.equal(canceled.version, 2);
    assert.equal(canceled.attemptCount, 1);
    assert.equal(canceled.title, before.title);
    assert.equal(canceled.content, before.content);
    assert.equal(canceled.maintenanceTime, before.maintenanceTime);
    assert.deepEqual(canceled.groupIds, before.groupIds);
    assert.equal(canceled.plannedAt, before.plannedAt);
    assert.equal(canceled.aggregate.requiresReconciliation, false);
    assert.deepEqual(canceled.aggregate.blockedGroupIds, []);
    assert.ok(
      canceled.aggregate.perGroup.every((target) => /取消/.test(target.reason)),
    );

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].id, before.attempts[0].id);
    assert.equal(detail.attempts[0].requestId, before.attempts[0].requestId);
    assert.equal(detail.attempts[0].number, 1);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, false);
    assert.equal(detail.attempts[0].endedAt, now);
    assert.match(detail.attempts[0].requestError, /取消/);
    assert.deepEqual(detail.attempts[0].results, []);
    assert.equal(detail.attempts[0].requiresReconciliation, false);
    assert.deepEqual(detail.attempts[0].targetGroupIds, [101, 202]);
    assert.deepEqual(detail.attempts[0].requestBody, before.attempts[0].requestBody);

    for (const tick of [now, now + 60_000, now + 24 * 60 * 60_000]) {
      now = tick;
      assert.equal((await maintenance.runOnce()).processed, false);
    }
    assert.equal(upstream.requests.length, 0);

    const restarted = createService(temp.databasePath, () => now);
    const persisted = await restarted.get(created.notice.id);
    assert.equal(persisted?.status, "canceled");
    assert.equal(persisted?.endedAt, canceled.endedAt);
    assert.equal((await restarted.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 0);

    await expectConflict(
      maintenance.cancel(created.notice.id, { version: 1 }),
      { status: "canceled", version: 2 },
    );
    await expectConflict(
      maintenance.cancel(created.notice.id, { version: 2 }),
      { status: "canceled", version: 2 },
    );
    await expectConflict(
      maintenance.update(created.notice.id, updatePayload()),
      { status: "canceled", version: 2 },
    );
    assert.equal(await maintenance.cancel("missing-notice", { version: 1 }), null);
  });

  it("preserves the original plan and target snapshot when a scheduled notice is canceled", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt, groupIds: [7, 8] }),
      "cancel-scheduled",
    );
    const before = await maintenance.get(created.notice.id);
    assert.ok(before);

    const canceled = await maintenance.cancel(created.notice.id, { version: 1 });
    assert.ok(canceled);
    assert.equal(canceled.mode, "scheduled");
    assert.equal(canceled.plannedAt, plannedAt);
    assert.deepEqual(canceled.groupIds, [7, 8]);
    assert.equal(canceled.endedAt, now);

    now = plannedAt + 1_000;
    assert.equal((await maintenance.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 0);

    const detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.status, "canceled");
    assert.equal(detail?.plannedAt, plannedAt);
    assert.deepEqual(detail?.attempts[0].targetGroupIds, [7, 8]);
    assert.deepEqual(
      detail?.attempts[0].requestBody,
      before.attempts[0].requestBody,
    );
    assert.equal(detail?.lastExecutedAttemptEndedAt, null);
    assert.match(detail?.attempts[0].requestError ?? "", /取消/);
  });

  it("rejects edits and cancellation after a claim, even while the upstream request is blocked", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [11, 22] }),
      "cancel-claimed",
    );
    const before = await maintenance.get(created.notice.id);
    assert.ok(before);

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

    try {
      assert.equal(during?.status, "sent");
      assert.equal(during?.activity, "running");

      await expectConflict(
        maintenance.update(created.notice.id, updatePayload({ title: "抢改标题" })),
        { status: "sent", activity: "running", versionAtLeast: 2 },
      );
      await expectConflict(
        maintenance.cancel(created.notice.id, { version: 1 }),
        { status: "sent", activity: "running", versionAtLeast: 2 },
      );
      await expectConflict(
        maintenance.cancel(created.notice.id, {
          version: during?.version ?? 2,
        }),
        { status: "sent", activity: "running" },
      );
    } finally {
      releaseRequest();
      await pendingRun;
    }

    assert.equal(upstream.requests.length, 1);
    assert.deepEqual(readJsonBody(upstream.requests[0]), {
      ...before.attempts[0].requestBody,
    });
    const after = await maintenance.get(created.notice.id);
    assert.equal(after?.title, before.title);
    assert.deepEqual(after?.attempts[0].requestBody, before.attempts[0].requestBody);
    assert.deepEqual(
      after?.attempts[0].targetGroupIds,
      before.attempts[0].targetGroupIds,
    );
  });

  it("rejects edits and cancellation after dispatch or a missed schedule", async () => {
    const sent = await maintenance.create(
      maintenanceInput({ groupIds: [31] }),
      "edit-after-send",
    );
    await maintenance.runOnce();
    assert.equal(upstream.requests.length, 1);

    await expectConflict(
      maintenance.update(sent.notice.id, updatePayload({ title: "发送后修改" })),
      { status: "sent" },
    );
    await expectConflict(
      maintenance.cancel(sent.notice.id, { version: 1 }),
      { status: "sent" },
    );

    const planned = await maintenance.create(
      maintenanceInput({ groupIds: [32], mode: "scheduled", plannedAt: now + 60_000 }),
      "edit-after-missed",
    );
    now = (planned.notice.plannedAt ?? now) + 60_001;
    assert.equal((await maintenance.runOnce()).processed, false);
    const missed = await maintenance.get(planned.notice.id);
    assert.equal(missed?.status, "missed");

    await expectConflict(
      maintenance.update(planned.notice.id, updatePayload({ title: "错过后再改" })),
      { status: "missed" },
    );
    await expectConflict(
      maintenance.cancel(planned.notice.id, { version: 1 }),
      { status: "missed" },
    );

    const stillMissed = await maintenance.get(planned.notice.id);
    assert.equal(stillMissed?.title, planned.notice.title);
    assert.equal(stillMissed?.status, "missed");
    assert.equal(upstream.requests.length, 1);
  });
});

describe("maintenance edit and cancel races", () => {
  it("gives update and claim mutually exclusive outcomes with exactly one upstream POST", async () => {
    for (const callOrder of ["update-first", "claim-first"]) {
      const groupId = callOrder === "update-first" ? 61 : 62;
      const created = await maintenance.create(
        maintenanceInput({ groupIds: [groupId] }),
        `edit-claim-race-${callOrder}`,
      );
      const before = await maintenance.get(created.notice.id);
      const requestsBefore = upstream.requests.length;
      const updater = createService(temp.databasePath, () => now);
      const worker = createService(temp.databasePath, () => now);
      const updateCall = updater.update(created.notice.id, {
        ...maintenanceInput({
          content: "竞态修改正文",
          groupIds: [groupId + 100],
          title: "竞态修改标题",
        }),
        version: 1,
      });

      const [updateResult, runResult] =
        callOrder === "update-first"
          ? await Promise.allSettled([updateCall, worker.runOnce()])
          : await Promise.allSettled([worker.runOnce(), updateCall]);

      assert.equal(updateResult.status, "fulfilled", callOrder);
      assert.equal(runResult.status, "fulfilled", callOrder);
      assert.equal(upstream.requests.length - requestsBefore, 1, callOrder);

      const detail = await maintenance.get(created.notice.id);
      assert.ok(detail);
      assert.equal(detail.status, "sent");
      assert.equal(detail.attemptCount, 1);
      assert.deepEqual(detail.attempts[0].targetGroupIds, [groupId + 100]);
      assert.equal(detail.title, "竞态修改标题");
      assert.equal(detail.attempts[0].requestId, before.attempts[0].requestId);
      const sent = readJsonBody(upstream.requests[requestsBefore]);
      assert.equal(sent.title, "竞态修改标题");
      assert.equal(sent.content, "竞态修改正文");
      assert.deepEqual(sent.group_ids, [groupId + 100]);
    }

    const claimWins = await maintenance.create(
      maintenanceInput({ groupIds: [63] }),
      "edit-claim-race-blocked",
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
    await waitFor(() => upstream.requests.length === 3);

    try {
      await expectConflict(
        maintenance.update(claimWins.notice.id, updatePayload({ title: "失败修改" })),
        { status: "sent" },
      );
    } finally {
      releaseRequest();
      await pendingRun;
    }
    assert.deepEqual(readJsonBody(upstream.requests[2]).title, "Komari 服务维护通知");
  });

  it("serializes cancel against runOnce so a notice is never both canceled and sent", async () => {
    for (const callOrder of ["cancel-first", "run-first"]) {
      const groupId = callOrder === "cancel-first" ? 71 : 72;
      const created = await maintenance.create(
        maintenanceInput({ groupIds: [groupId] }),
        `cancel-run-race-${callOrder}`,
      );
      const requestsBefore = upstream.requests.length;
      const canceller = createService(temp.databasePath, () => now);
      const worker = createService(temp.databasePath, () => now);
      const cancelCall = canceller.cancel(created.notice.id, { version: 1 });
      const runCall = worker.runOnce();

      const [cancelResult, runResult] =
        callOrder === "cancel-first"
          ? await Promise.allSettled([cancelCall, runCall])
          : await Promise.allSettled([runCall, cancelCall]);

      assert.equal(runResult.status, "fulfilled", callOrder);
      const detail = await maintenance.get(created.notice.id);
      assert.ok(detail);

      if (cancelResult.status === "fulfilled") {
        assert.ok(cancelResult.value);
        assert.equal(detail.status, "canceled", callOrder);
        assert.equal(upstream.requests.length - requestsBefore, 0, callOrder);
      } else {
        assert.equal(detail.status, "sent", callOrder);
        assert.equal(upstream.requests.length - requestsBefore, 1, callOrder);
        assert.equal(cancelResult.reason.name, "MaintenanceConflictError");
        assert.ok(cancelResult.reason.currentNotice);
        assert.equal(cancelResult.reason.currentNotice.status, "sent");
      }

      assert.equal(detail.attemptCount, 1);
      assert.notEqual(detail.status, "upcoming");
    }
  });

  it("keeps cancellation and missed-expiry mutually exclusive under the same write lock", async () => {
    const canceledPlan = now + 60_000;
    const canceledFirst = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: canceledPlan, groupIds: [81] }),
      "cancel-expiry-cancel-wins",
    );
    now = canceledPlan + 60_001;
    const requestsBefore = upstream.requests.length;
    const canceller = createService(temp.databasePath, () => now);
    const worker = createService(temp.databasePath, () => now);

    const canceled = await canceller.cancel(canceledFirst.notice.id, { version: 1 });
    assert.ok(canceled);
    assert.equal(canceled.status, "canceled");
    assert.equal((await worker.runOnce()).processed, false);
    assert.equal(upstream.requests.length - requestsBefore, 0);

    const expiredPlan = now + 60_000;
    const expiryFirst = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: expiredPlan, groupIds: [82] }),
      "cancel-expiry-expiry-wins",
    );
    now = expiredPlan + 60_001;
    assert.equal((await worker.runOnce()).processed, false);
    const missed = await maintenance.get(expiryFirst.notice.id);
    assert.equal(missed?.status, "missed");

    await expectConflict(canceller.cancel(expiryFirst.notice.id, { version: 1 }), {
      status: "missed",
      version: 2,
    });
    const after = await maintenance.get(expiryFirst.notice.id);
    assert.equal(after?.status, "missed");
    assert.equal(after?.attemptCount, 1);
    assert.equal(after?.lastExecutedAttemptEndedAt, null);
    assert.equal(upstream.requests.length - requestsBefore, 0);
  });
});

describe("maintenance edit, scheduling, cancel, and retry integration", () => {
  it("sends the edited scheduled snapshot and retries only its edited failed subset", async () => {
    const originalPlannedAt = now + 10 * 60_000;
    const created = await maintenance.create(
      maintenanceInput({
        content: "旧版正文",
        groupIds: [1, 2],
        maintenanceTime: "2026-10-01 09:00 - 10:00",
        mode: "scheduled",
        plannedAt: originalPlannedAt,
        title: "旧版标题",
      }),
      "edit-schedule-retry-base",
    );
    const createdDetail = await maintenance.get(created.notice.id);
    assert.ok(createdDetail);
    const originalRequestId = createdDetail.attempts[0].requestId;

    now += 1_000;
    const edited = {
      content: "新版正文\n第二行内容",
      groupIds: [2, 3],
      maintenanceTime: "2026-12-01 10:00 - 11:00",
      mode: "scheduled",
      plannedAt: now + 20 * 60_000,
      title: "新版维护标题",
    };
    const updated = await maintenance.update(created.notice.id, {
      ...maintenanceInput(edited),
      version: 1,
    });
    assert.ok(updated);
    assert.deepEqual(updated.groupIds, [2, 3]);

    now = originalPlannedAt;
    assert.equal((await maintenance.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 0);

    upstream.setHandler((request) => ({
      body: {
        results: readJsonBody(request).group_ids.map((groupId) =>
          groupId === 3
            ? {
                bot_id: "bot-1",
                error: "敏感词拦截",
                error_code: "send_failed",
                group_id: groupId,
                status: "failed",
                success: false,
              }
            : {
                bot_id: "bot-1",
                error: null,
                error_code: null,
                group_id: groupId,
                status: "success",
                success: true,
              },
        ),
      },
    }));

    now = edited.plannedAt;
    assert.equal((await maintenance.runOnce()).processed, true);
    assert.equal(upstream.requests.length, 1);
    assert.deepEqual(readJsonBody(upstream.requests[0]), {
      content: edited.content,
      group_ids: [2, 3],
      scheduled_time: edited.maintenanceTime,
      title: edited.title,
    });

    const sent = await maintenance.get(created.notice.id);
    assert.ok(sent);
    assert.equal(sent.status, "sent");
    assert.equal(sent.attempts.length, 1);
    assert.equal(sent.attempts[0].requestId, originalRequestId);
    assert.deepEqual(
      sent.attempts[0].results.map((result) => [
        result.groupId,
        result.outcome,
      ]),
      [
        [2, "success"],
        [3, "failed"],
      ],
    );

    now = edited.plannedAt + 61_000;
    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, [3]);
    assert.equal(preview.blockedReason, null);

    upstream.setHandler((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));
    const retry = await maintenance.retry(
      created.notice.id,
      { groupIds: [3], version: preview.version },
      "edit-schedule-retry-key",
    );
    assert.equal(retry.created, true);
    assert.equal(retry.notice.attemptCount, 2);

    const retried = await maintenance.runOnce();
    assert.equal(retried.processed, true);
    assert.equal(retried.attemptId, retry.attemptId);
    assert.equal(upstream.requests.length, 2);
    assert.deepEqual(readJsonBody(upstream.requests[1]), {
      content: edited.content,
      group_ids: [3],
      scheduled_time: edited.maintenanceTime,
      title: edited.title,
    });

    for (const request of upstream.requests) {
      assert.ok(
        !readJsonBody(request).group_ids.includes(1),
        "the original first group must never be sent",
      );
    }

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "sent");
    assert.equal(detail.attempts.length, 2);
    assert.equal(detail.attempts[1].number, 2);
    assert.notEqual(detail.attempts[1].requestId, originalRequestId);
    assert.equal(
      upstream.requests[1].headers["x-request-id"],
      detail.attempts[1].requestId,
    );
    assert.deepEqual(detail.groupIds, [2, 3]);
    assert.equal(detail.aggregate.success, 2);
    assert.equal(detail.aggregate.failed, 0);
    assert.equal((await maintenance.list()).length, 1);
  });

  it("blocks retry preview and manual retry once a queued notice is canceled", async () => {
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [11, 22] }),
      "cancel-then-retry-blocked",
    );
    const before = await maintenance.get(created.notice.id);
    assert.ok(before);

    now += 500;
    const canceled = await maintenance.cancel(created.notice.id, { version: 1 });
    assert.ok(canceled);
    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.version, 2);
    assert.equal(canceled.endedAt, now);
    assert.equal(canceled.attemptCount, 1);

    const preview = await maintenance.previewRetry(created.notice.id);
    assert.ok(preview);
    assert.deepEqual(preview.targetGroupIds, []);
    assert.match(preview.blockedReason ?? "", /只有状态为已发送/);

    await assert.rejects(
      maintenance.retry(
        created.notice.id,
        { groupIds: [11, 22], version: preview.version },
        "cancel-then-retry-blocked-key",
      ),
      (error) => {
        assert.equal(error.name, "MaintenanceConflictError");
        assert.match(error.message, /可重试目标群已变化/);
        return true;
      },
    );

    for (const tick of [now, now + 60_000, now + 24 * 60 * 60_000]) {
      now = tick;
      assert.equal((await maintenance.runOnce()).processed, false);
    }
    assert.equal(upstream.requests.length, 0);

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "canceled");
    assert.equal(detail.version, 2);
    assert.equal(detail.attemptCount, 1);
    assert.equal(detail.endedAt, canceled.endedAt);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].id, before.attempts[0].id);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, false);
    assert.match(detail.attempts[0].requestError ?? "", /取消/);
    assert.deepEqual(detail.attempts[0].results, []);
    assert.deepEqual(detail.groupIds, [11, 22]);
  });
});

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
