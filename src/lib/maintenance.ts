/**
 * Shared, dependency-free maintenance domain types and rules.
 *
 * This module is imported by both the server-side business facade and the
 * browser UI. Keep it free of Node.js, Next.js, and React imports.
 */

export const MAINTENANCE_AUDIT_REASON = "发送维护通知";
export const MAINTENANCE_INTERRUPTED_REASON = "执行进程中断，结果未知";
export const MAINTENANCE_MISSED_REASON = "已错过计划发送时间，未调用上游发送";
export const MAINTENANCE_RETRY_AUDIT_REASON = "手动重试维护通知";
export const MAINTENANCE_MISSING_RESULT_REASON = "上游未返回结果";

export const MAINTENANCE_SCHEDULED_START_WINDOW_MS = 60_000;

export const MAINTENANCE_UPSTREAM_PATH = "/api/v2/komari-announce/maintenance";

export const MAINTENANCE_SUBMISSION_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export const MAINTENANCE_GROUP_LIMIT = 100;

export const MAINTENANCE_TEXT_BUDGETS = {
  content: { maxBytes: 9000, maxCodepoints: 3000, maxTokens: 3000 },
  maintenanceTime: { maxBytes: 512, maxCodepoints: 128, maxTokens: 128 },
  title: { maxBytes: 512, maxCodepoints: 128, maxTokens: 128 },
} as const;

export type MaintenanceTextBudget = keyof typeof MAINTENANCE_TEXT_BUDGETS;

export type MaintenanceMode = "immediate" | "scheduled";

export type MaintenanceNoticeStatus =
  | "upcoming"
  | "sent"
  | "missed"
  | "canceled";

export type MaintenanceOutcome =
  | "success"
  | "failed"
  | "unreachable"
  | "unknown";

export type MaintenanceAttemptPhase = "queued" | "running" | "completed";

export type MaintenanceCreateInput = {
  title: string;
  content: string;
  maintenanceTime: string;
  groupIds: number[];
  mode: MaintenanceMode;
  plannedAt: number | null;
};

export type MaintenanceUpstreamRequestBody = {
  title: string;
  content: string;
  scheduled_time: string;
  group_ids: number[];
};

export type MaintenanceTargetEvidence = {
  groupId: number;
  outcome: MaintenanceOutcome;
  reason: string;
  errorCode: string | null;
  error: string | null;
  botId: string | null;
  requiresReconciliation: boolean;
};

export type MaintenanceAttemptTotals = {
  total: number;
  success: number;
  failed: number;
  unreachable: number;
  unknown: number;
};

export type MaintenanceAttempt = {
  id: string;
  noticeId: string;
  number: number;
  requestId: string;
  auditReason: string;
  phase: MaintenanceAttemptPhase;
  executed: boolean;
  requestBody: MaintenanceUpstreamRequestBody;
  targetGroupIds: number[];
  results: MaintenanceTargetEvidence[];
  totals: MaintenanceAttemptTotals;
  startedAt: number | null;
  endedAt: number | null;
  requestError: string | null;
  remainingSeconds: number | null;
  requiresReconciliation: boolean;
};

export type MaintenanceAggregateTarget = {
  groupId: number;
  outcome: MaintenanceOutcome | null;
  reason: string | null;
  retryBlocked: boolean;
  requiresReconciliation: boolean;
};

export type MaintenanceNoticeAggregate = {
  total: number;
  success: number;
  failed: number;
  unreachable: number;
  unknown: number;
  pending: number;
  perGroup: MaintenanceAggregateTarget[];
  allSuccess: boolean;
  requiresReconciliation: boolean;
  blockedGroupIds: number[];
};

export type MaintenanceNoticeSummary = {
  id: string;
  title: string;
  content: string;
  maintenanceTime: string;
  groupIds: number[];
  mode: MaintenanceMode;
  plannedAt: number | null;
  status: MaintenanceNoticeStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  lastExecutedAttemptEndedAt: number | null;
  activity: "queued" | "running" | null;
  attemptCount: number;
  aggregate: MaintenanceNoticeAggregate;
};

export type MaintenanceNotice = MaintenanceNoticeSummary & {
  attempts: MaintenanceAttempt[];
};

export type MaintenanceCreateResult = {
  notice: MaintenanceNoticeSummary;
  created: boolean;
};

export type MaintenanceRetryPreview = {
  noticeId: string;
  version: number;
  title: string;
  content: string;
  maintenanceTime: string;
  targetGroupIds: number[];
  blockedReason: string | null;
};

export type MaintenanceRetryInput = {
  version: number;
  groupIds: number[];
};

export type MaintenanceRetryResult = {
  notice: MaintenanceNoticeSummary;
  attemptId: string;
  created: boolean;
};

export type MaintenanceRunResult = {
  processed: boolean;
  noticeId: string | null;
  attemptId: string | null;
};

export type MaintenanceUpstreamConfig = {
  apiOrigin: string;
  bearerToken: string;
};

export type MaintenanceUpstreamProvider =
  | MaintenanceUpstreamConfig
  | (() =>
      | MaintenanceUpstreamConfig
      | Promise<MaintenanceUpstreamConfig>);

export type MaintenanceServiceOptions = {
  databasePath: string;
  now?: () => number;
  upstream: MaintenanceUpstreamProvider;
};

export type MaintenanceService = {
  create(
    input: MaintenanceCreateInput,
    submissionId: string,
  ): Promise<MaintenanceCreateResult>;
  list(): Promise<MaintenanceNoticeSummary[]>;
  get(id: string): Promise<MaintenanceNotice | null>;
  previewRetry(id: string): Promise<MaintenanceRetryPreview | null>;
  retry(
    id: string,
    input: MaintenanceRetryInput,
    submissionId: string,
  ): Promise<MaintenanceRetryResult>;
  runOnce(): Promise<MaintenanceRunResult>;
};

export type MaintenanceAggregateAttemptInput = {
  executed: boolean;
  phase: MaintenanceAttemptPhase;
  requiresReconciliation: boolean;
  targetGroupIds: number[];
  results: MaintenanceTargetEvidence[];
  requestError: string | null;
  remainingSeconds: number | null;
};

export class MaintenanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceInputError";
  }
}

export class MaintenanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceConflictError";
  }
}

export class MaintenanceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceNotFoundError";
  }
}

/**
 * Validate and normalize the public create input. Validation never truncates
 * input; text is trimmed first and then checked against each budget dimension
 * in a fixed order: codepoints, UTF-8 bytes, estimated tokens.
 */
export function parseMaintenanceCreateInput(
  value: unknown,
): MaintenanceCreateInput {
  if (!isRecord(value)) {
    throw new MaintenanceInputError("请求体必须是 JSON 对象。");
  }

  const allowedKeys = new Set([
    "title",
    "content",
    "maintenanceTime",
    "groupIds",
    "mode",
    "plannedAt",
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new MaintenanceInputError(`请求包含未知字段：${key}。`);
    }
  }

  const title = readStringField(value, "title", "标题");
  const maintenanceTime = readStringField(
    value,
    "maintenanceTime",
    "维护时间",
  );
  const content = readStringField(value, "content", "正文");

  const normalizedTitle = normalizeRequiredText("标题", title, "title");
  const normalizedMaintenanceTime = normalizeRequiredText(
    "维护时间",
    maintenanceTime,
    "maintenanceTime",
  );
  const normalizedContent = normalizeRequiredText("正文", content, "content");

  const mode = readMaintenanceMode(value.mode);
  const plannedAt = readPlannedAt(mode, value.plannedAt);

  const groupIds = normalizeGroupIds(value.groupIds);

  return {
    content: normalizedContent,
    groupIds,
    maintenanceTime: normalizedMaintenanceTime,
    mode,
    plannedAt,
    title: normalizedTitle,
  };
}

export function validateMaintenanceSubmissionId(value: unknown): string {
  if (typeof value !== "string" || !MAINTENANCE_SUBMISSION_ID_PATTERN.test(value)) {
    throw new MaintenanceInputError("缺少有效的 X-Request-ID 提交标识。");
  }

  return value;
}

const SHANGHAI_DATE_TIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Convert the calendar components of a datetime-local input as Asia/Shanghai
 * wall time. The result never depends on the browser or server time zone.
 */
export function parseMaintenanceShanghaiDateTimeLocal(value: string): number {
  const match = SHANGHAI_DATE_TIME_LOCAL_PATTERN.exec(value);

  if (!match) {
    throw new MaintenanceInputError(
      "计划发送时间格式应为 YYYY-MM-DDTHH:mm。",
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new MaintenanceInputError("计划发送时间是无效的日期时间。");
  }

  const epoch =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    SHANGHAI_OFFSET_MS;
  const local = new Date(epoch + SHANGHAI_OFFSET_MS);

  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    throw new MaintenanceInputError("计划发送时间是无效的日期时间。");
  }

  return epoch;
}

/**
 * Validate and normalize the manual retry confirmation body. Callers may only
 * confirm the previewed version and ordered target list; content and target
 * expansion are not accepted.
 */
export function parseMaintenanceRetryInput(value: unknown): MaintenanceRetryInput {
  if (!isRecord(value)) {
    throw new MaintenanceInputError("请求体必须是 JSON 对象。");
  }

  const allowedKeys = new Set(["version", "groupIds"]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new MaintenanceInputError(`请求包含未知字段：${key}。`);
    }
  }

  const version = value.version;

  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new MaintenanceInputError("版本号必须是正整数。");
  }

  return {
    groupIds: normalizeGroupIds(value.groupIds),
    version,
  };
}

export function estimateMaintenanceTokens(text: string): number {
  const codepoints = countCodepoints(text);
  const bytes = new TextEncoder().encode(text).byteLength;

  return Math.max(Math.ceil(codepoints / 4), Math.ceil(bytes / 3));
}

export function countCodepoints(text: string): number {
  return [...text].length;
}

/**
 * Calculate the notice-level aggregate. The latest actually executed attempt
 * supplies evidence for the groups it participated in; groups outside that
 * attempt snapshot retain their earlier outcome. A reconciliation-required
 * rejection overrides affected outcomes so downstream retries stay blocked.
 */
export function buildMaintenanceAggregate(
  originalGroupIds: readonly number[],
  attempts: readonly MaintenanceAggregateAttemptInput[],
): MaintenanceNoticeAggregate {
  const originalSet = new Set(originalGroupIds);
  const evidence = new Map<
    number,
    Omit<MaintenanceAggregateTarget, "groupId">
  >();
  const rejectionDiagnostics = new Map<number, string>();

  for (const attempt of attempts) {
    if (attempt.phase !== "completed") {
      continue;
    }

    const snapshot = attempt.targetGroupIds.filter((groupId) =>
      originalSet.has(groupId),
    );

    if (attempt.executed) {
      const resultsByGroup = new Map(
        attempt.results.map((result) => [result.groupId, result] as const),
      );

      for (const groupId of snapshot) {
        const result = resultsByGroup.get(groupId);

        if (!result) {
          evidence.set(groupId, {
            outcome: "unknown",
            reason: MAINTENANCE_MISSING_RESULT_REASON,
            requiresReconciliation: true,
            retryBlocked: true,
          });
        } else {
          const requiresReconciliation =
            result.requiresReconciliation || result.outcome === "unknown";

          evidence.set(groupId, {
            outcome: result.outcome,
            reason: result.reason,
            requiresReconciliation,
            retryBlocked: requiresReconciliation,
          });
        }

        rejectionDiagnostics.delete(groupId);
      }

      continue;
    }

    if (attempt.requiresReconciliation) {
      const reason = buildReconciliationReason(attempt.requestError);

      for (const groupId of snapshot) {
        evidence.set(groupId, {
          outcome: "unknown",
          reason,
          requiresReconciliation: true,
          retryBlocked: true,
        });
        rejectionDiagnostics.delete(groupId);
      }

      continue;
    }

    const diagnostic = buildRejectionDiagnostic(
      attempt.requestError,
      attempt.remainingSeconds,
    );

    if (!diagnostic) {
      continue;
    }

    for (const groupId of snapshot) {
      if (!evidence.has(groupId)) {
        rejectionDiagnostics.set(groupId, diagnostic);
      }
    }
  }

  let success = 0;
  let failed = 0;
  let unreachable = 0;
  let unknown = 0;
  let pending = 0;

  const perGroup = originalGroupIds.map((groupId) => {
    const executedEvidence = evidence.get(groupId);
    const rejectionDiagnostic = rejectionDiagnostics.get(groupId);
    let target: MaintenanceAggregateTarget;

    if (executedEvidence) {
      target = { groupId, ...executedEvidence };
    } else if (rejectionDiagnostic) {
      target = {
        groupId,
        outcome: "unknown",
        reason: rejectionDiagnostic,
        requiresReconciliation: false,
        retryBlocked: false,
      };
    } else {
      target = {
        groupId,
        outcome: null,
        reason: null,
        requiresReconciliation: false,
        retryBlocked: false,
      };
    }

    switch (target.outcome) {
      case "success":
        success += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "unreachable":
        unreachable += 1;
        break;
      case "unknown":
        unknown += 1;
        break;
      default:
        pending += 1;
    }

    return target;
  });

  const total = originalGroupIds.length;

  return {
    allSuccess: total > 0 && success === total,
    blockedGroupIds: perGroup
      .filter((target) => target.retryBlocked)
      .map((target) => target.groupId),
    failed,
    pending,
    perGroup,
    requiresReconciliation: perGroup.some(
      (target) => target.requiresReconciliation,
    ),
    success,
    total,
    unknown,
    unreachable,
  };
}

export function formatMaintenanceTimestamp(value: number | null): string {
  if (value === null) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    hour12: false,
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function getMaintenanceNoticeStatusLabel(
  status: MaintenanceNoticeStatus,
  activity: "queued" | "running" | null,
): string {
  if (status === "upcoming") {
    if (activity === "running") {
      return "执行中";
    }

    if (activity === "queued") {
      return "等待执行";
    }

    return "待发送";
  }

  switch (status) {
    case "sent":
      return "已发送";
    case "missed":
      return "已错过";
    case "canceled":
      return "已取消";
  }
}

export function getMaintenanceOutcomeLabel(
  outcome: MaintenanceOutcome | null,
): string {
  switch (outcome) {
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "unreachable":
      return "未调用平台发送";
    case "unknown":
      return "结果未知";
    default:
      return "未记录";
  }
}

export function describeMaintenanceAggregate(
  aggregate: MaintenanceNoticeAggregate,
): string {
  if (aggregate.total === 0) {
    return "无目标群";
  }

  if (aggregate.allSuccess) {
    return "全部成功";
  }

  if (aggregate.pending === aggregate.total) {
    return "等待执行";
  }

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
    parts.push(`待执行 ${aggregate.pending}`);
  }

  return `共 ${aggregate.total} 个目标群：${parts.join(" · ")}`;
}

function readStringField(
  value: Record<string, unknown>,
  key: string,
  label: string,
) {
  const field = value[key];

  if (typeof field !== "string") {
    throw new MaintenanceInputError(`${label}必须是文本。`);
  }

  return field;
}

function readMaintenanceMode(value: unknown): MaintenanceMode {
  if (value === "immediate" || value === "scheduled") {
    return value;
  }

  throw new MaintenanceInputError("发送方式必须是立即发送或定时发送。");
}

function readPlannedAt(mode: MaintenanceMode, value: unknown) {
  if (mode === "immediate") {
    if (value !== null) {
      throw new MaintenanceInputError("立即发送的通知不能设置计划时间。");
    }

    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !isRepresentableTimestamp(value)
  ) {
    throw new MaintenanceInputError("定时发送必须提供有效的计划发送时间。");
  }

  return value;
}

function isRepresentableTimestamp(value: number) {
  return Number.isFinite(new Date(value).getTime());
}

function normalizeRequiredText(
  label: string,
  rawValue: string,
  budgetKey: MaintenanceTextBudget,
) {
  const text = rawValue.trim();

  if (!text) {
    throw new MaintenanceInputError(`${label}不能为空。`);
  }

  assertValidUnicode(label, text);
  assertTextBudget(label, text, budgetKey);

  return text;
}

function assertValidUnicode(label: string, text: string) {
  if (hasLoneSurrogate(text)) {
    throw new MaintenanceInputError(`${label}包含无效的 Unicode 字符。`);
  }
}

function hasLoneSurrogate(text: string) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }

      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function assertTextBudget(
  label: string,
  text: string,
  budgetKey: MaintenanceTextBudget,
) {
  const budget = MAINTENANCE_TEXT_BUDGETS[budgetKey];
  const codepoints = countCodepoints(text);

  if (codepoints > budget.maxCodepoints) {
    throw new MaintenanceInputError(
      `${label}不能超过 ${budget.maxCodepoints} 个字符。`,
    );
  }

  const bytes = new TextEncoder().encode(text).byteLength;

  if (bytes > budget.maxBytes) {
    throw new MaintenanceInputError(
      `${label} UTF-8 编码不能超过 ${budget.maxBytes} 字节。`,
    );
  }

  const tokens = estimateMaintenanceTokens(text);

  if (tokens > budget.maxTokens) {
    throw new MaintenanceInputError(
      `${label}估算 token 不能超过 ${budget.maxTokens}。`,
    );
  }
}

function normalizeGroupIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new MaintenanceInputError("目标群必须是群号数组。");
  }

  if (value.length < 1) {
    throw new MaintenanceInputError("请至少选择一个目标群。");
  }

  if (value.length > MAINTENANCE_GROUP_LIMIT) {
    throw new MaintenanceInputError(
      `目标群最多 ${MAINTENANCE_GROUP_LIMIT} 个。`,
    );
  }

  const seen = new Set<number>();

  for (const groupId of value) {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) {
      throw new MaintenanceInputError("群号必须是正的安全整数。");
    }

    if (seen.has(groupId)) {
      throw new MaintenanceInputError("群号不能重复。");
    }

    seen.add(groupId);
  }

  return [...value];
}

function buildReconciliationReason(requestError: string | null) {
  const detail = requestError?.trim() || "未提供诊断";

  return `上游返回冲突，需人工核对：${detail}`;
}

function buildRejectionDiagnostic(
  requestError: string | null,
  remainingSeconds: number | null,
) {
  const message = requestError?.trim() || "上游拒绝请求，结果未知。";

  if (remainingSeconds !== null && Number.isFinite(remainingSeconds)) {
    return `${message}（剩余冷却 ${remainingSeconds} 秒）`;
  }

  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
