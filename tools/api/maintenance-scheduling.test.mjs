import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTempDatabase,
  loadMaintenanceModules,
  maintenanceInput,
  startFakeUpstream,
  successfulResponse,
  readJsonBody,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const modules = await loadMaintenanceModules();
const { lib, service } = modules;

let temp;
let now;
let maintenance;
let upstream;

beforeEach(async () => {
  temp = await createTempDatabase("maintenance-scheduling-");
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

describe("scheduled maintenance input", () => {
  it("interprets calendar components in Asia/Shanghai without browser local time", () => {
    assert.equal(
      lib.parseMaintenanceShanghaiDateTimeLocal("2026-11-01T22:30"),
      1_793_543_400_000,
    );
    assert.equal(
      lib.parseMaintenanceShanghaiDateTimeLocal("2026-11-01T00:00"),
      1_793_462_400_000,
    );
    assert.equal(
      lib.parseMaintenanceShanghaiDateTimeLocal("2026-11-01T23:59:59"),
      1_793_548_799_000,
    );
  });

  it("rejects malformed or impossible Shanghai calendar times", () => {
    for (const value of [
      "",
      "2026-11-01 22:30",
      "2026-11-01T22:30:00Z",
      "2026-02-30T10:00",
      "2026-11-01T24:00",
      "2026-11-01T22:60",
      "2026-11-01T22:30:60",
    ]) {
      assert.throws(
        () => lib.parseMaintenanceShanghaiDateTimeLocal(value),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          return true;
        },
        value,
      );
    }
  });

  it("accepts scheduled mode with an epoch planned time and keeps immediate default shape", () => {
    const scheduled = lib.parseMaintenanceCreateInput(
      maintenanceInput({
        mode: "scheduled",
        plannedAt: 1_793_543_400_000,
      }),
    );

    assert.equal(scheduled.mode, "scheduled");
    assert.equal(scheduled.plannedAt, 1_793_543_400_000);
    assert.equal(scheduled.maintenanceTime, "2026-11-01 22:00 - 23:00");

    const immediate = lib.parseMaintenanceCreateInput(maintenanceInput());
    assert.equal(immediate.mode, "immediate");
    assert.equal(immediate.plannedAt, null);
  });

  it("rejects missing or invalid scheduling shape but not past planned times", () => {
    for (const invalid of [
      { mode: "scheduled", plannedAt: null },
      { mode: "scheduled" },
      { mode: "scheduled", plannedAt: "1793543400000" },
      { mode: "scheduled", plannedAt: 1.5 },
      { mode: "scheduled", plannedAt: Number.MAX_SAFE_INTEGER + 1 },
      { mode: "scheduled", plannedAt: Number.MAX_SAFE_INTEGER },
      { mode: "scheduled", plannedAt: 8_640_000_000_000_001 },
      { mode: "scheduled", plannedAt: 0 },
      { mode: "later", plannedAt: 1_793_543_400_000 },
      { mode: "immediate", plannedAt: 1_793_543_400_000 },
    ]) {
      assert.throws(
        () => lib.parseMaintenanceCreateInput(maintenanceInput(invalid)),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          return true;
        },
        JSON.stringify(invalid),
      );
    }

    const past = lib.parseMaintenanceCreateInput(
      maintenanceInput({ mode: "scheduled", plannedAt: now - 1_000 }),
    );
    assert.equal(past.plannedAt, now - 1_000);

    const maxDate = lib.parseMaintenanceCreateInput(
      maintenanceInput({
        mode: "scheduled",
        plannedAt: 8_640_000_000_000_000,
      }),
    );
    assert.equal(maxDate.plannedAt, 8_640_000_000_000_000);
  });
});

describe("scheduled maintenance durable creation", () => {
  it("persists the planned epoch independently from the maintenance time", async () => {
    const plannedAt = now + 10 * 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-create-key",
    );

    assert.equal(created.created, true);
    assert.equal(created.notice.mode, "scheduled");
    assert.equal(created.notice.plannedAt, plannedAt);
    assert.equal(created.notice.status, "upcoming");
    assert.equal(created.notice.activity, "queued");
    assert.equal(created.notice.maintenanceTime, "2026-11-01 22:00 - 23:00");

    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.deepEqual(detail.attempts[0].requestBody, {
      content: "预计维护 10 分钟\n期间可能出现短暂不可用",
      group_ids: [101, 202],
      scheduled_time: "2026-11-01 22:00 - 23:00",
      title: "Komari 服务维护通知",
    });
    assert.deepEqual(Object.keys(detail.attempts[0].requestBody).sort(), [
      "content",
      "group_ids",
      "scheduled_time",
      "title",
    ]);
  });

  it("rejects a new scheduled input at or before the current clock", async () => {
    for (const plannedAt of [now, now - 1_000]) {
      await assert.rejects(
        maintenance.create(
          maintenanceInput({ mode: "scheduled", plannedAt }),
          `scheduled-past-${plannedAt}`,
        ),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /计划发送时间/);
          return true;
        },
      );
    }

    assert.deepEqual(await maintenance.list(), []);
    assert.equal(upstream.requests.length, 0);
  });

  it("rejects unrepresentable timestamps and allows the representable Date limit", async () => {
    for (const plannedAt of [
      Number.MAX_SAFE_INTEGER,
      8_640_000_000_000_001,
    ]) {
      await assert.rejects(
        maintenance.create(
          maintenanceInput({ mode: "scheduled", plannedAt }),
          `scheduled-unrepresentable-${plannedAt}`,
        ),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /计划发送时间/);
          return true;
        },
      );
    }

    assert.deepEqual(await maintenance.list(), []);
    assert.equal(upstream.requests.length, 0);

    const created = await maintenance.create(
      maintenanceInput({
        mode: "scheduled",
        plannedAt: 8_640_000_000_000_000,
      }),
      "scheduled-max-date-key",
    );

    assert.equal(created.created, true);
    assert.equal(created.notice.plannedAt, 8_640_000_000_000_000);
    assert.equal(created.notice.status, "upcoming");
  });

  it("returns the durable task for a same-input replay after its plan passed", async () => {
    const plannedAt = now + 60_000;
    const first = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-replay-key",
    );
    now = plannedAt + 5 * 60_000;

    const replay = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-replay-key",
    );

    assert.equal(replay.created, false);
    assert.equal(replay.notice.id, first.notice.id);
    assert.equal(replay.notice.plannedAt, plannedAt);
    assert.equal(replay.notice.status, "upcoming");
    assert.equal(replay.notice.attemptCount, 1);
  });
});

describe("scheduled dispatch eligibility", () => {
  it("does not call upstream before the planned time", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-future-key",
    );

    const run = await maintenance.runOnce();

    assert.equal(run.processed, false);
    assert.equal(upstream.requests.length, 0);
    const detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.status, "upcoming");
    assert.equal(detail?.activity, "queued");
    assert.equal(detail?.attempts[0].phase, "queued");
    assert.equal(detail?.attempts[0].startedAt, null);
  });

  it("starts at the planned time and across the inclusive 60 second window", async () => {
    const first = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 60_000 }),
      "scheduled-on-time-key",
    );
    now = first.notice.plannedAt;
    assert.equal((await maintenance.runOnce()).processed, true);

    const second = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 60_000 }),
      "scheduled-late-window-key",
    );
    now = second.notice.plannedAt + 60_000;
    assert.equal((await maintenance.runOnce()).processed, true);

    const third = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 60_000 }),
      "scheduled-just-inside-window-key",
    );
    now = third.notice.plannedAt + 59_999;
    assert.equal((await maintenance.runOnce()).processed, true);

    assert.equal(upstream.requests.length, 3);
    for (const created of [first, second, third]) {
      const detail = await maintenance.get(created.notice.id);
      assert.equal(detail?.status, "sent");
      assert.equal(detail?.aggregate.allSuccess, true);
    }
  });

  it("marks work missed after the window and never replays it automatically", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-missed-key",
    );
    now = plannedAt + 60_001;

    const run = await maintenance.runOnce();

    assert.equal(run.processed, false);
    assert.equal(upstream.requests.length, 0);
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "missed");
    assert.equal(detail.plannedAt, plannedAt);
    assert.equal(detail.endedAt, now);
    assert.equal(detail.activity, null);
    assert.equal(detail.lastExecutedAttemptEndedAt, null);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, false);
    assert.match(detail.attempts[0].requestError, /错过/);
    assert.deepEqual(detail.attempts[0].results, []);
    assert.equal(detail.aggregate.requiresReconciliation, false);
    assert.deepEqual(detail.aggregate.blockedGroupIds, []);
    assert.equal(detail.aggregate.perGroup[0].outcome, "unknown");
    assert.match(detail.aggregate.perGroup[0].reason, /错过/);

    now += 60 * 60_000;
    assert.equal((await maintenance.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 0);
    const after = await maintenance.get(created.notice.id);
    assert.equal(after?.status, "missed");
    assert.equal(after?.attempts.length, 1);
  });

  it("does not apply the 60 second window as a completion deadline", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-slow-completion-key",
    );
    now = plannedAt + 1_000;
    upstream.setHandler((request) => {
      now = plannedAt + 120_000;

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });

    const run = await maintenance.runOnce();

    assert.equal(run.processed, true);
    const detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "sent");
    assert.equal(detail.activity, null);
    assert.equal(detail.plannedAt, plannedAt);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].endedAt, plannedAt + 120_000);
    assert.equal(detail.aggregate.allSuccess, true);
    assert.equal(upstream.requests.length, 1);
  });

  it("sorts upcoming scheduled work by planned time before creation time", async () => {
    const far = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 300_000 }),
      "sort-far-key",
    );
    now += 1_000;
    const immediate = await maintenance.create(
      maintenanceInput(),
      "sort-immediate-key",
    );
    now += 1_000;
    const later = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 120_000 }),
      "sort-later-key",
    );
    now += 1_000;
    const sooner = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: now + 60_000 }),
      "sort-sooner-key",
    );

    const list = await maintenance.list();

    assert.deepEqual(
      list.map((notice) => notice.id),
      [immediate.notice.id, sooner.notice.id, later.notice.id, far.notice.id],
    );
    assert.deepEqual(
      list.map((notice) => notice.mode),
      ["immediate", "scheduled", "scheduled", "scheduled"],
    );
  });

  it("allows only one of two workers to dispatch scheduled work", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "scheduled-concurrent-key",
    );
    now = plannedAt + 1_000;
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
    assert.equal(detail?.status, "sent");
  });

  it("recovers queued scheduled work after restart only inside the window", async () => {
    const insidePlannedAt = now + 60_000;
    const inside = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: insidePlannedAt }),
      "restart-inside-key",
    );
    const restartedInside = createService(temp.databasePath, () => now);
    now = insidePlannedAt + 30_000;

    assert.equal((await restartedInside.runOnce()).processed, true);
    assert.equal(upstream.requests.length, 1);

    const outsidePlannedAt = now + 60_000;
    const outside = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt: outsidePlannedAt }),
      "restart-outside-key",
    );
    const restartedOutside = createService(temp.databasePath, () => now);
    now = outsidePlannedAt + 60_001;

    assert.equal((await restartedOutside.runOnce()).processed, false);
    assert.equal(upstream.requests.length, 1);

    const insideDetail = await maintenance.get(inside.notice.id);
    const outsideDetail = await maintenance.get(outside.notice.id);
    assert.equal(insideDetail?.status, "sent");
    assert.equal(outsideDetail?.status, "missed");
    assert.equal(outsideDetail?.plannedAt, outsidePlannedAt);
  });
});

describe("maintenance interrupted execution recovery", () => {
  it("recovers an expired running lease as unknown evidence and fences the stale owner", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "recovery-expired-lease-key",
    );
    now = plannedAt + 1_000;
    let releaseRequest;
    const gate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    upstream.setHandler(async (request) => {
      await gate;

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });

    const staleRun = maintenance.runOnce();
    await waitFor(() => upstream.requests.length === 1);
    const requestId = upstream.requests[0].headers["x-request-id"];
    now += 31_000;
    const restarted = createService(temp.databasePath, () => now);

    const recovery = await restarted.runOnce();

    assert.equal(recovery.processed, false);
    assert.equal(upstream.requests.length, 1);
    let detail = await maintenance.get(created.notice.id);
    assert.ok(detail);
    assert.equal(detail.status, "sent");
    assert.equal(detail.activity, null);
    assert.equal(detail.endedAt, now);
    assert.equal(detail.lastExecutedAttemptEndedAt, now);
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].requestId, requestId);
    assert.equal(detail.attempts[0].phase, "completed");
    assert.equal(detail.attempts[0].executed, true);
    assert.equal(detail.attempts[0].requiresReconciliation, true);
    assert.match(detail.attempts[0].requestError, /中断/);
    assert.equal(detail.attempts[0].endedAt, now);
    assert.deepEqual(
      detail.attempts[0].results.map((result) => [
        result.groupId,
        result.outcome,
        result.reason,
      ]),
      [
        [101, "unknown", "执行进程中断，结果未知"],
        [202, "unknown", "执行进程中断，结果未知"],
      ],
    );
    assert.deepEqual(detail.aggregate.blockedGroupIds, [101, 202]);
    assert.equal(detail.aggregate.requiresReconciliation, true);

    releaseRequest();
    await assert.rejects(staleRun, /失去执行权/);

    detail = await maintenance.get(created.notice.id);
    assert.equal(detail?.attempts[0].requestId, requestId);
    assert.equal(detail?.attempts[0].requiresReconciliation, true);
    assert.equal(detail?.attempts[0].results[0].outcome, "unknown");
    assert.equal(upstream.requests.length, 1);
  });

  it("leaves a healthy unexpired running lease untouched", async () => {
    const plannedAt = now + 60_000;
    const created = await maintenance.create(
      maintenanceInput({ mode: "scheduled", plannedAt }),
      "recovery-healthy-lease-key",
    );
    now = plannedAt;
    let releaseRequest;
    const gate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    upstream.setHandler(async (request) => {
      await gate;

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });

    const activeRun = maintenance.runOnce();
    await waitFor(() => upstream.requests.length === 1);
    now += 29_000;
    const other = createService(temp.databasePath, () => now);

    const otherRun = await other.runOnce();
    assert.equal(otherRun.processed, false);
    const during = await maintenance.get(created.notice.id);
    assert.equal(during?.status, "sent");
    assert.equal(during?.activity, "running");
    assert.equal(during?.attempts[0].phase, "running");
    assert.deepEqual(during?.attempts[0].results, []);
    assert.equal(upstream.requests.length, 1);

    releaseRequest();
    await activeRun;
    const after = await maintenance.get(created.notice.id);
    assert.equal(after?.activity, null);
    assert.equal(after?.attempts[0].phase, "completed");
    assert.equal(after?.attempts[0].executed, true);
    assert.equal(after?.aggregate.allSuccess, true);
    assert.equal(upstream.requests.length, 1);
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
