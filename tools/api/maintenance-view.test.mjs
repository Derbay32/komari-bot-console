import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { loadTypeScriptModule } from "./typescript-modules.mjs";

const viewUrl = loadTypeScriptModule("src/lib/maintenance-view.ts");
const view = await import(viewUrl);

describe("announcement list view model", () => {
  it("counts notices across both statuses instead of counting attempts", () => {
    const notices = [
      summary({
        groupIds: [101],
        id: "upcoming-1",
        plannedAt: 2_000,
        status: "upcoming",
      }),
      summary({
        attemptCount: 4,
        groupIds: [101, 202],
        id: "sent-1",
        outcomes: ["success", "failed"],
        startedAt: 5_000,
      }),
      summary({
        attemptCount: 2,
        groupIds: [202],
        id: "sent-2",
        outcomes: ["success"],
        startedAt: 4_000,
      }),
    ];
    const model = buildModel(notices, { scope: "all" });

    assert.deepEqual(
      model.scopeOptions.map((option) => [option.scope, option.count]),
      [
        ["all", 3],
        [101, 2],
        [202, 2],
      ],
    );
    assert.equal(model.upcoming.total, 1);
    assert.equal(model.history.total, 2);
    assert.deepEqual(
      model.history.items.map((notice) => notice.id),
      ["sent-1", "sent-2"],
    );
  });

  it("lists a cross-group notice once in each matching scope", () => {
    const notices = [
      summary({
        groupIds: [101, 202],
        id: "shared",
        outcomes: ["success", "unknown"],
        startedAt: 5_000,
      }),
      summary({
        groupIds: [202],
        id: "second-group-only",
        outcomes: ["success"],
        startedAt: 4_000,
      }),
    ];

    assert.deepEqual(historyIds(buildModel(notices, { scope: "all" })), [
      "shared",
      "second-group-only",
    ]);
    assert.deepEqual(historyIds(buildModel(notices, { scope: 101 })), [
      "shared",
    ]);
    assert.deepEqual(historyIds(buildModel(notices, { scope: 202 })), [
      "shared",
      "second-group-only",
    ]);
  });

  it("shows the selected group result instead of the notice-wide success", () => {
    const notice = summary({
      groupIds: [101, 202],
      id: "mixed",
      outcomes: ["success", "unknown"],
      startedAt: 5_000,
    });

    const all = view.getAnnouncementStatusView(notice, "all");
    assert.equal(all.label, "部分成功");
    assert.match(all.detail, /成功 1/);
    assert.match(all.detail, /结果未知 1/);

    assert.equal(view.getAnnouncementStatusView(notice, 101).label, "成功");

    const unknown = view.getAnnouncementStatusView(notice, 202);
    assert.equal(unknown.label, "结果未知");
    assert.equal(unknown.requiresReconciliation, true);
  });

  it("shows 8 success and 2 unknown instead of all success", () => {
    const groupIds = Array.from({ length: 10 }, (_value, index) => index + 1);
    const outcomes = groupIds.map((_groupId, index) =>
      index < 8
        ? "success"
        : {
            outcome: "unknown",
            reason: "上游未返回结果",
            requiresReconciliation: true,
          },
    );
    const notice = summary({
      groupIds,
      id: "eight-and-two",
      outcomes,
      startedAt: 5_000,
    });
    // A misleading stored flag must not override the per-group evidence.
    notice.aggregate.allSuccess = true;

    const all = view.getAnnouncementStatusView(notice, "all");
    assert.equal(all.label, "部分成功");
    assert.match(all.detail, /共 10 个目标群/);
    assert.match(all.detail, /成功 8/);
    assert.match(all.detail, /结果未知 2/);
    assert.notEqual(all.label, "全部成功");
    assert.equal(view.getAnnouncementStatusView(notice, 9).label, "结果未知");
    assert.equal(view.getAnnouncementStatusView(notice, 10).label, "结果未知");
  });

  it("respects authoritative reconciliation flags for unknown outcomes", () => {
    const rejection = summary({
      groupIds: [101],
      id: "rate-limited",
      outcomes: [
        {
          outcome: "unknown",
          reason: "请求被限流（剩余冷却 30 秒）",
          requiresReconciliation: false,
        },
      ],
      startedAt: 5_000,
    });
    const rejectionAll = view.getAnnouncementStatusView(rejection, "all");
    assert.equal(rejectionAll.label, "结果未知");
    assert.equal(rejectionAll.requiresReconciliation, false);
    assert.doesNotMatch(rejectionAll.detail, /需人工核对/);

    const rejectionGroup = view.getAnnouncementStatusView(rejection, 101);
    assert.equal(rejectionGroup.label, "结果未知");
    assert.equal(rejectionGroup.requiresReconciliation, false);
    assert.doesNotMatch(rejectionGroup.detail, /需人工核对/);

    const unknown = summary({
      groupIds: [101],
      id: "delivery-unknown",
      outcomes: [
        {
          outcome: "unknown",
          reason: "上游未返回结果",
          requiresReconciliation: true,
        },
      ],
      startedAt: 5_000,
    });
    const unknownAll = view.getAnnouncementStatusView(unknown, "all");
    assert.equal(unknownAll.label, "结果未知");
    assert.equal(unknownAll.requiresReconciliation, true);
    assert.match(unknownAll.detail, /需人工核对/);

    const unknownGroup = view.getAnnouncementStatusView(unknown, 101);
    assert.equal(unknownGroup.label, "结果未知");
    assert.equal(unknownGroup.requiresReconciliation, true);
    assert.match(unknownGroup.detail, /需人工核对/);
  });

  it("keeps persisted history with ID-only options when the group lookup fails", () => {
    const notice = summary({
      groupIds: [4_242],
      id: "orphan",
      outcomes: ["success"],
      startedAt: 5_000,
    });
    const model = buildModel([notice], { groups: [], scope: 4_242 });
    const option = model.scopeOptions.find((item) => item.scope === 4_242);

    assert.equal(option.name, "4242");
    assert.equal(option.hasKnownName, false);
    assert.equal(option.count, 1);
    assert.equal(model.scope, 4_242);
    assert.deepEqual(historyIds(model), ["orphan"]);
  });

  it("sorts upcoming by plan time with a creation-time fallback and history newest first", () => {
    const notices = [
      summary({
        createdAt: 1_000,
        id: "late",
        plannedAt: 3_000,
        status: "upcoming",
      }),
      summary({
        createdAt: 2_000,
        id: "early",
        plannedAt: 1_000,
        status: "upcoming",
      }),
      summary({
        createdAt: 2_000,
        id: "immediate",
        plannedAt: null,
        status: "upcoming",
      }),
      summary({
        createdAt: 1_000,
        id: "sent",
        outcomes: ["success"],
        plannedAt: 1_000,
        startedAt: 5_000,
      }),
      summary({
        createdAt: 1_000,
        id: "missed",
        plannedAt: 7_000,
        status: "missed",
      }),
      summary({
        createdAt: 1_000,
        endedAt: 6_000,
        id: "canceled",
        plannedAt: 2_000,
        status: "canceled",
        updatedAt: 6_000,
      }),
    ];
    const model = buildModel(notices, { scope: "all" });

    assert.deepEqual(
      model.upcoming.items.map((notice) => notice.id),
      ["early", "immediate", "late"],
    );
    assert.deepEqual(historyIds(model), ["missed", "sent", "canceled"]);
  });

  it("labels canceled and missed records without inventing results", () => {
    const canceled = summary({
      endedAt: 6_000,
      groupIds: [101, 102],
      id: "canceled",
      plannedAt: 2_000,
      status: "canceled",
      updatedAt: 6_500,
    });
    const canceledTiming = view.getAnnouncementTimingView(canceled);
    assert.equal(canceledTiming.label, "取消时间");
    assert.equal(canceledTiming.value, 6_000);
    assert.equal(canceledTiming.note, "未执行发送");
    assert.equal(canceledTiming.plannedAt, 2_000);
    const canceledStatus = view.getAnnouncementStatusView(canceled, "all");
    assert.equal(canceledStatus.label, "已取消");
    assert.doesNotMatch(canceledStatus.detail, /成功/);

    const canceledWithoutEnd = summary({
      createdAt: 1_000,
      groupIds: [101],
      id: "canceled-without-end",
      plannedAt: 2_000,
      status: "canceled",
      updatedAt: 6_500,
    });
    assert.equal(
      view.getAnnouncementTimingView(canceledWithoutEnd).value,
      null,
    );

    const missed = summary({
      id: "missed",
      plannedAt: 7_000,
      status: "missed",
    });
    const missedTiming = view.getAnnouncementTimingView(missed);
    assert.equal(missedTiming.label, "计划发送");
    assert.equal(missedTiming.value, 7_000);
    assert.equal(missedTiming.note, "实际发送：未执行");
    assert.equal(view.getAnnouncementStatusView(missed, "all").label, "已错过");
  });

  it("paginates each list independently before rendering and clamps shrinking data", () => {
    const upcoming = Array.from({ length: 12 }, (_value, index) =>
      summary({
        createdAt: 1_000 + index,
        id: `u${String(index + 1).padStart(2, "0")}`,
        plannedAt: 1_000 + index,
        status: "upcoming",
      }),
    );
    const history = Array.from({ length: 7 }, (_value, index) =>
      summary({
        groupIds: [101],
        id: `h${String(index + 1).padStart(2, "0")}`,
        outcomes: ["success"],
        startedAt: 9_000 - index,
      }),
    );

    const model = buildModel([...upcoming, ...history], {
      historyPage: 3,
      scope: "all",
      upcomingPage: 2,
    });
    assert.equal(model.upcoming.page, 2);
    assert.equal(model.upcoming.pageCount, 3);
    assert.deepEqual(
      model.upcoming.items.map((notice) => notice.id),
      ["u06", "u07", "u08", "u09", "u10"],
    );
    assert.equal(model.history.page, 2);
    assert.equal(model.history.pageCount, 2);
    assert.equal(model.history.items.length, 2);

    const firstPage = buildModel([...upcoming, ...history], { scope: "all" });
    assert.equal(firstPage.upcoming.items.length, 5);
    assert.equal(firstPage.history.items.length, 5);

    const shrunk = buildModel(upcoming.slice(0, 3), {
      historyPage: 4,
      scope: "all",
      upcomingPage: 4,
    });
    assert.equal(shrunk.upcoming.page, 1);
    assert.equal(shrunk.upcoming.pageCount, 1);
    assert.equal(shrunk.history.page, 1);
    assert.equal(shrunk.history.pageCount, 1);
    assert.equal(shrunk.history.total, 0);
  });

  it("filters and sorts before pagination", () => {
    const notices = [
      ...Array.from({ length: 8 }, (_value, index) =>
        summary({
          groupIds: [101],
          id: `matching-${index + 1}`,
          plannedAt: 8_000 - index * 1_000,
          status: "upcoming",
        }),
      ),
      ...Array.from({ length: 4 }, (_value, index) =>
        summary({
          groupIds: [202],
          id: `other-${index + 1}`,
          plannedAt: 1_000 + index,
          status: "upcoming",
        }),
      ),
    ];
    const model = buildModel(notices, { scope: 101, upcomingPage: 2 });

    assert.equal(model.upcoming.total, 8);
    assert.equal(model.upcoming.pageCount, 2);
    assert.deepEqual(
      model.upcoming.items.map((notice) => notice.id),
      ["matching-3", "matching-2", "matching-1"],
    );
  });

  it("resets both pages on a scope change and keeps pages independent", () => {
    const state = { historyPage: 3, scope: "all", upcomingPage: 2 };

    assert.deepEqual(
      view.reduceAnnouncementListState(state, {
        scope: 202,
        type: "selectScope",
      }),
      { historyPage: 1, scope: 202, upcomingPage: 1 },
    );
    assert.deepEqual(
      view.reduceAnnouncementListState(state, {
        page: 1,
        type: "setUpcomingPage",
      }),
      { historyPage: 3, scope: "all", upcomingPage: 1 },
    );
    assert.deepEqual(
      view.reduceAnnouncementListState(state, {
        page: 2,
        type: "setHistoryPage",
      }),
      { historyPage: 2, scope: "all", upcomingPage: 2 },
    );
  });
});

function buildModel(notices, patch = {}) {
  return view.buildAnnouncementListModel({
    groups: patch.groups ?? [
      { group_id: 101, group_name: "测试一群" },
      { group_id: 202, group_name: "测试二群" },
    ],
    historyPage: patch.historyPage ?? 1,
    notices,
    scope: patch.scope ?? "all",
    upcomingPage: patch.upcomingPage ?? 1,
  });
}

function historyIds(model) {
  return model.history.items.map((notice) => notice.id);
}

function summary(patch = {}) {
  const id = patch.id ?? "notice-1";
  const groupIds = patch.groupIds ?? [101];
  const outcomes = patch.outcomes ?? [];
  const perGroup = groupIds.map((groupId, index) => {
    const entry = outcomes[index];
    const outcome =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? entry.outcome
          : null;
    const requiresReconciliation =
      typeof entry === "object"
        ? Boolean(entry.requiresReconciliation)
        : outcome === "unknown";

    return {
      groupId,
      outcome,
      reason:
        typeof entry === "object" && entry !== null
          ? (entry.reason ?? null)
          : null,
      requiresReconciliation,
      retryBlocked: requiresReconciliation,
    };
  });
  const counts = {
    failed: 0,
    pending: 0,
    success: 0,
    unknown: 0,
    unreachable: 0,
  };

  perGroup.forEach((target) => {
    if (target.outcome === null) {
      counts.pending += 1;
    } else {
      counts[target.outcome] += 1;
    }
  });

  return {
    activity: patch.activity ?? null,
    aggregate: {
      allSuccess: perGroup.length > 0 && counts.success === perGroup.length,
      blockedGroupIds: perGroup
        .filter((target) => target.retryBlocked)
        .map((target) => target.groupId),
      failed: counts.failed,
      pending: counts.pending,
      perGroup,
      requiresReconciliation: perGroup.some(
        (target) => target.requiresReconciliation,
      ),
      success: counts.success,
      total: perGroup.length,
      unknown: counts.unknown,
      unreachable: counts.unreachable,
    },
    attemptCount: patch.attemptCount ?? 1,
    content: `正文 ${id}`,
    createdAt: patch.createdAt ?? 1_800_000_000_000,
    endedAt: patch.endedAt ?? null,
    groupIds,
    id,
    lastExecutedAttemptEndedAt: null,
    maintenanceTime: "2026-11-01 22:00 - 23:00",
    mode: patch.mode ?? (patch.plannedAt ? "scheduled" : "immediate"),
    plannedAt: patch.plannedAt ?? null,
    startedAt: patch.startedAt ?? null,
    status: patch.status ?? "sent",
    title: `通知 ${id}`,
    updatedAt: patch.updatedAt ?? patch.createdAt ?? 1_800_000_000_000,
    version: 1,
  };
}
