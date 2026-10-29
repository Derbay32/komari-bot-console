/**
 * Pure view-model for the announcement list page.
 *
 * The list scope only decides which persisted notices are displayed and which
 * outcome is shown next to a row. It never rewrites notice targets, creation
 * drafts, or the read-only detail payload.
 */

import type {
  MaintenanceNoticeSummary,
  MaintenanceOutcome,
} from "@/lib/maintenance";

export const ANNOUNCEMENT_PAGE_SIZE = 5;

/** `"all"` or an original target group ID. */
export type AnnouncementScope = "all" | number;

export type AnnouncementGroup = {
  group_id: number;
  group_name: string;
};

export type AnnouncementScopeOption = {
  scope: AnnouncementScope;
  name: string;
  groupId: number | null;
  count: number;
  hasKnownName: boolean;
};

export type AnnouncementStatusColor =
  | "success"
  | "processing"
  | "error"
  | "warning"
  | "gold"
  | "default";

export type AnnouncementStatusView = {
  label: string;
  color: AnnouncementStatusColor;
  detail: string;
  requiresReconciliation: boolean;
};

export type AnnouncementTimingView = {
  label: string;
  value: number | null;
  note: string | null;
  /** A separate plan timestamp when the primary value is not the plan. */
  plannedAt: number | null;
};

export type AnnouncementPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
};

export type AnnouncementListModel = {
  scope: AnnouncementScope;
  scopeLabel: string;
  scopeDescription: string;
  scopeOptions: AnnouncementScopeOption[];
  upcoming: AnnouncementPage<MaintenanceNoticeSummary>;
  history: AnnouncementPage<MaintenanceNoticeSummary>;
};

export type AnnouncementListState = {
  scope: AnnouncementScope;
  upcomingPage: number;
  historyPage: number;
};

export const INITIAL_ANNOUNCEMENT_LIST_STATE: AnnouncementListState = {
  historyPage: 1,
  scope: "all",
  upcomingPage: 1,
};

export type AnnouncementListAction =
  | { type: "selectScope"; scope: AnnouncementScope }
  | { type: "setUpcomingPage"; page: number }
  | { type: "setHistoryPage"; page: number };

export function reduceAnnouncementListState(
  state: AnnouncementListState,
  action: AnnouncementListAction,
): AnnouncementListState {
  switch (action.type) {
    case "selectScope":
      return { historyPage: 1, scope: action.scope, upcomingPage: 1 };
    case "setUpcomingPage":
      return { ...state, upcomingPage: Math.max(1, action.page) };
    case "setHistoryPage":
      return { ...state, historyPage: Math.max(1, action.page) };
  }
}

export function buildAnnouncementListModel({
  notices,
  groups,
  scope,
  upcomingPage,
  historyPage,
}: {
  notices: readonly MaintenanceNoticeSummary[];
  groups: readonly AnnouncementGroup[];
  scope: AnnouncementScope;
  upcomingPage: number;
  historyPage: number;
}): AnnouncementListModel {
  const scopeOptions = buildAnnouncementScopeOptions(notices, groups);
  const selected =
    scopeOptions.find((option) => option.scope === scope) ?? scopeOptions[0];
  const scopedNotices = filterAnnouncementNotices(notices, selected.scope);
  const upcoming = scopedNotices
    .filter((notice) => notice.status === "upcoming")
    .sort(compareUpcoming);
  const history = scopedNotices
    .filter((notice) => notice.status !== "upcoming")
    .sort(compareHistory);

  return {
    history: paginateAnnouncements(history, historyPage),
    scope: selected.scope,
    scopeDescription:
      selected.scope === "all"
        ? "包含所有群聊的通知。每条通知只显示一次；状态按完整原始目标群汇总。"
        : `只显示目标包含「${selected.name}」的通知。每条通知只显示一次；状态和结果取该群聊自身。`,
    scopeLabel: selected.name,
    scopeOptions,
    upcoming: paginateAnnouncements(upcoming, upcomingPage),
  };
}

export function buildAnnouncementScopeOptions(
  notices: readonly MaintenanceNoticeSummary[],
  groups: readonly AnnouncementGroup[],
): AnnouncementScopeOption[] {
  const referencedGroupIds = new Set<number>();

  notices.forEach((notice) => {
    notice.groupIds.forEach((groupId) => referencedGroupIds.add(groupId));
  });

  const seenGroupIds = new Set<number>();
  const options: AnnouncementScopeOption[] = [
    {
      count: notices.length,
      groupId: null,
      hasKnownName: true,
      name: "全部",
      scope: "all",
    },
  ];

  groups.forEach((group) => {
    if (seenGroupIds.has(group.group_id)) {
      return;
    }

    seenGroupIds.add(group.group_id);
    const name = group.group_name.trim();
    const hasKnownName = name.length > 0;

    options.push({
      count: countNoticesForGroup(notices, group.group_id),
      groupId: group.group_id,
      hasKnownName,
      name: hasKnownName ? name : String(group.group_id),
      scope: group.group_id,
    });
  });

  [...referencedGroupIds]
    .filter((groupId) => !seenGroupIds.has(groupId))
    .sort((left, right) => left - right)
    .forEach((groupId) => {
      options.push({
        count: countNoticesForGroup(notices, groupId),
        groupId,
        hasKnownName: false,
        name: String(groupId),
        scope: groupId,
      });
    });

  return options;
}

export function filterAnnouncementNotices(
  notices: readonly MaintenanceNoticeSummary[],
  scope: AnnouncementScope,
): MaintenanceNoticeSummary[] {
  if (scope === "all") {
    return [...notices];
  }

  return notices.filter((notice) => notice.groupIds.includes(scope));
}

export function paginateAnnouncements<T>(
  items: readonly T[],
  requestedPage: number,
): AnnouncementPage<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / ANNOUNCEMENT_PAGE_SIZE));
  const page = Math.min(Math.max(Math.trunc(requestedPage) || 1, 1), pageCount);
  const start = (page - 1) * ANNOUNCEMENT_PAGE_SIZE;

  return {
    items: items.slice(start, start + ANNOUNCEMENT_PAGE_SIZE),
    page,
    pageCount,
    total,
  };
}

/**
 * The aggregate status always uses the notice-level aggregate, which is built
 * from the complete original target list. A missing result is counted as
 * unknown and can never turn into a successful group.
 */
export function getAnnouncementStatusView(
  notice: MaintenanceNoticeSummary,
  scope: AnnouncementScope,
): AnnouncementStatusView {
  if (scope !== "all" && !notice.groupIds.includes(scope)) {
    return {
      color: "default",
      detail: "当前群聊不在该通知的原始目标中。",
      label: "不适用",
      requiresReconciliation: false,
    };
  }

  switch (notice.status) {
    case "upcoming":
      return getUpcomingStatusView(notice, scope);
    case "canceled":
      return {
        color: "default",
        detail:
          scope === "all"
            ? `任务已取消，未执行发送；${notice.aggregate.total} 个目标群无发送结果。`
            : "任务已取消，该群聊未执行发送。",
        label: "已取消",
        requiresReconciliation: false,
      };
    case "missed":
      return {
        color: "default",
        detail:
          scope === "all"
            ? `计划发送时间已过，${notice.aggregate.total} 个目标群未执行发送。`
            : "计划发送时间已过，该群聊未执行发送。",
        label: "已错过",
        requiresReconciliation: false,
      };
    case "sent":
      return scope === "all"
        ? getAggregateStatusView(notice)
        : getGroupStatusView(notice, scope);
  }
}

export function getAnnouncementTimingView(
  notice: MaintenanceNoticeSummary,
): AnnouncementTimingView {
  switch (notice.status) {
    case "upcoming":
      return notice.plannedAt !== null
        ? {
            label: "计划发送",
            note: "尚未发送",
            plannedAt: null,
            value: notice.plannedAt,
          }
        : {
            label: "创建时间",
            note: "等待执行",
            plannedAt: null,
            value: notice.createdAt,
          };
    case "canceled":
      return {
        label: "取消时间",
        note: "未执行发送",
        plannedAt: notice.plannedAt,
        value: notice.endedAt,
      };
    case "missed":
      return {
        label: "计划发送",
        note: "实际发送：未执行",
        plannedAt: null,
        value: notice.plannedAt ?? notice.createdAt,
      };
    case "sent":
      return {
        label: "发送时间",
        note: null,
        plannedAt: notice.plannedAt,
        value: notice.startedAt ?? notice.endedAt,
      };
  }
}

function countNoticesForGroup(
  notices: readonly MaintenanceNoticeSummary[],
  groupId: number,
): number {
  return notices.filter((notice) => notice.groupIds.includes(groupId)).length;
}

function upcomingSortAt(notice: MaintenanceNoticeSummary): number {
  return notice.plannedAt ?? notice.createdAt;
}

function historySortAt(notice: MaintenanceNoticeSummary): number {
  return notice.status === "sent"
    ? (notice.startedAt ?? notice.plannedAt ?? notice.createdAt)
    : (notice.plannedAt ?? notice.createdAt);
}

function compareUpcoming(
  left: MaintenanceNoticeSummary,
  right: MaintenanceNoticeSummary,
): number {
  return (
    upcomingSortAt(left) - upcomingSortAt(right) ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function compareHistory(
  left: MaintenanceNoticeSummary,
  right: MaintenanceNoticeSummary,
): number {
  return (
    historySortAt(right) - historySortAt(left) ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function getUpcomingStatusView(
  notice: MaintenanceNoticeSummary,
  scope: AnnouncementScope,
): AnnouncementStatusView {
  const total = notice.aggregate.total;

  if (notice.activity === "running") {
    return {
      color: "processing",
      detail:
        scope === "all" ? `${total} 个目标群正在发送。` : "该群聊正在发送。",
      label: "执行中",
      requiresReconciliation: false,
    };
  }

  if (notice.activity === "queued") {
    return {
      color: "processing",
      detail:
        scope === "all"
          ? `${total} 个目标群等待 Worker 执行。`
          : "该群聊等待 Worker 执行。",
      label: "等待执行",
      requiresReconciliation: false,
    };
  }

  return {
    color: "processing",
    detail:
      scope === "all" ? `${total} 个目标群待发送。` : "该群聊待发送。",
    label: "待发送",
    requiresReconciliation: false,
  };
}

function getAggregateStatusView(
  notice: MaintenanceNoticeSummary,
): AnnouncementStatusView {
  const aggregate = notice.aggregate;
  const total = aggregate.total;

  if (total === 0) {
    return {
      color: "default",
      detail: "该通知没有原始目标群。",
      label: "无目标群",
      requiresReconciliation: false,
    };
  }

  if (
    aggregate.success === total &&
    aggregate.failed === 0 &&
    aggregate.unreachable === 0 &&
    aggregate.unknown === 0 &&
    aggregate.pending === 0
  ) {
    return {
      color: "success",
      detail: `成功 ${aggregate.success} 个目标群。`,
      label: "全部成功",
      requiresReconciliation: aggregate.requiresReconciliation,
    };
  }

  if (aggregate.failed === total) {
    return {
      color: "error",
      detail: `失败 ${aggregate.failed} 个目标群。`,
      label: "失败",
      requiresReconciliation: aggregate.requiresReconciliation,
    };
  }

  if (aggregate.unknown === total) {
    return {
      color: "warning",
      detail: aggregate.requiresReconciliation
        ? `结果未知 ${aggregate.unknown} 个目标群，需人工核对。`
        : `结果未知 ${aggregate.unknown} 个目标群。`,
      label: "结果未知",
      requiresReconciliation: aggregate.requiresReconciliation,
    };
  }

  if (aggregate.unreachable === total) {
    return {
      color: "default",
      detail: `未调用平台发送 ${aggregate.unreachable} 个目标群。`,
      label: "未调用平台发送",
      requiresReconciliation: aggregate.requiresReconciliation,
    };
  }

  if (aggregate.pending === total) {
    return {
      color: "default",
      detail: `未记录 ${aggregate.pending} 个目标群结果。`,
      label: "未记录",
      requiresReconciliation: aggregate.requiresReconciliation,
    };
  }

  return {
    color: aggregate.success > 0 ? "gold" : "warning",
    detail: describeAggregateCounts(aggregate),
    label: aggregate.success > 0 ? "部分成功" : "结果不一",
    requiresReconciliation: aggregate.requiresReconciliation,
  };
}

function describeAggregateCounts(
  aggregate: MaintenanceNoticeSummary["aggregate"],
): string {
  const parts: string[] = [];

  if (aggregate.success > 0) {
    parts.push(`成功 ${aggregate.success}`);
  }
  if (aggregate.failed > 0) {
    parts.push(`失败 ${aggregate.failed}`);
  }
  if (aggregate.unreachable > 0) {
    parts.push(`未调用平台发送 ${aggregate.unreachable}`);
  }
  if (aggregate.unknown > 0) {
    parts.push(`结果未知 ${aggregate.unknown}`);
  }
  if (aggregate.pending > 0) {
    parts.push(`未记录 ${aggregate.pending}`);
  }

  return `共 ${aggregate.total} 个目标群：${parts.join(" · ")}`;
}

function getGroupStatusView(
  notice: MaintenanceNoticeSummary,
  groupId: number,
): AnnouncementStatusView {
  const target = notice.aggregate.perGroup.find(
    (item) => item.groupId === groupId,
  );

  if (!target) {
    return {
      color: "default",
      detail: "该群聊未记录发送结果。",
      label: "未记录",
      requiresReconciliation: false,
    };
  }

  return describeOutcome(target.outcome, target.requiresReconciliation);
}

function describeOutcome(
  outcome: MaintenanceOutcome | null,
  requiresReconciliation: boolean,
): AnnouncementStatusView {
  switch (outcome) {
    case "success":
      return {
        color: "success",
        detail: "该群聊发送成功。",
        label: "成功",
        requiresReconciliation,
      };
    case "failed":
      return {
        color: "error",
        detail: "该群聊发送失败。",
        label: "失败",
        requiresReconciliation,
      };
    case "unreachable":
      return {
        color: "default",
        detail: "该群聊未调用平台发送。",
        label: "未调用平台发送",
        requiresReconciliation,
      };
    case "unknown":
      return {
        color: "warning",
        detail: requiresReconciliation
          ? "该群聊结果未知，需人工核对。"
          : "该群聊结果未知。",
        label: "结果未知",
        requiresReconciliation,
      };
    default:
      return {
        color: "default",
        detail: "该群聊未记录发送结果。",
        label: "未记录",
        requiresReconciliation,
      };
  }
}
