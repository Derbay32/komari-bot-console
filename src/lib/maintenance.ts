/**
 * Shared, dependency-free maintenance domain types and rules.
 *
 * This module is imported by both the server-side business facade and the
 * browser UI. Keep it free of Node.js, Next.js, and React imports.
 */

export const MAINTENANCE_AUDIT_REASON = "发送维护通知";
export const MAINTENANCE_INTERRUPTED_REASON = "执行进程中断，结果未知";
export const MAINTENANCE_MISSED_REASON = "已错过计划发送时间，未调用上游发送";
export const MAINTENANCE_CANCELED_REASON = "通知已取消，未调用上游发送";
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

export type MaintenanceUpdateInput = MaintenanceCreateInput & {
  version: number;
};

export type MaintenanceCancelInput = {
  version: number;
};

export type MaintenanceConflictPayload = {
  message: string;
  currentNotice: MaintenanceNoticeSummary;
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
  update(
    id: string,
    input: MaintenanceUpdateInput,
  ): Promise<MaintenanceNoticeSummary | null>;
  cancel(
    id: string,
    input: MaintenanceCancelInput,
  ): Promise<MaintenanceNoticeSummary | null>;
  list(): Promise<MaintenanceNoticeSummary[]>;
  get(id: string): Promise<MaintenanceNotice | null>;
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
  readonly currentNotice: MaintenanceNoticeSummary | undefined;

  constructor(
    message: string,
    currentNotice?: MaintenanceNoticeSummary,
  ) {
    super(message);
    this.name = "MaintenanceConflictError";
    this.currentNotice = currentNotice;
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

/**
 * Validate an edit payload through the same field, text-budget, group, and
 * scheduling rules as creation. The caller-supplied version is the optimistic
 * concurrency token; unknown fields stay unknown so creation rejects them.
 */
export function parseMaintenanceUpdateInput(
  value: unknown,
): MaintenanceUpdateInput {
  if (!isRecord(value)) {
    throw new MaintenanceInputError("请求体必须是 JSON 对象。");
  }

  const version = readMaintenanceVersion(value);
  const formValues: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(value)) {
    if (key !== "version") {
      formValues[key] = field;
    }
  }

  return { ...parseMaintenanceCreateInput(formValues), version };
}

export function parseMaintenanceCancelInput(
  value: unknown,
): MaintenanceCancelInput {
  if (!isRecord(value)) {
    throw new MaintenanceInputError("请求体必须是 JSON 对象。");
  }

  for (const key of Object.keys(value)) {
    if (key !== "version") {
      throw new MaintenanceInputError(`请求包含未知字段：${key}。`);
    }
  }

  return { version: readMaintenanceVersion(value) };
}

/**
 * Read the 409 payload returned by the update and cancel endpoints. Returns
 * null when the response does not carry the server's current notice state.
 */
export function readMaintenanceConflictPayload(
  payload: unknown,
): MaintenanceConflictPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const message = payload.message;
  const currentNotice = payload.currentNotice;

  if (typeof message !== "string" || !isMaintenanceNoticeSummary(currentNotice)) {
    return null;
  }

  return { currentNotice, message };
}

const SHANGHAI_DATE_TIME_LOCAL_PATTERN =
  /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Convert the calendar components of a datetime-local input as Asia/Shanghai
 * wall time. The result never depends on the browser or server time zone.
 * Extended years are validated at calendar midnight so that a wall time later
 * than the Date range's UTC side can still produce a representable epoch.
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

  const midnight = Date.UTC(year, month - 1, day);
  const calendar = new Date(midnight);

  if (
    !Number.isFinite(midnight) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    throw new MaintenanceInputError("计划发送时间是无效的日期时间。");
  }

  const epoch =
    midnight +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * 1000 -
    SHANGHAI_OFFSET_MS;
  const instant = new Date(epoch);

  if (!Number.isFinite(epoch) || Number.isNaN(instant.getTime())) {
    throw new MaintenanceInputError("计划发送时间是无效的日期时间。");
  }

  return epoch;
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

/**
 * Format an epoch as a datetime-local value in Asia/Shanghai wall time. The
 * result never depends on the browser or server time zone. Seconds are only
 * included when needed so minute-precision plans round-trip unchanged.
 *
 * Calendar fields come from Intl with an explicit Asia/Shanghai time zone. Do
 * not derive them by adding the UTC offset to the epoch: that overflows the
 * representable Date range at Date.MAX, while Intl renders it correctly.
 */
export function formatMaintenanceShanghaiDateTimeLocal(value: number): string {
  const parts = SHANGHAI_DATE_TIME_LOCAL_FORMATTER.formatToParts(value);
  const year = readMaintenanceFormatterPart(parts, "year").padStart(4, "0");
  const month = readMaintenanceFormatterPart(parts, "month");
  const day = readMaintenanceFormatterPart(parts, "day");
  const hour = readMaintenanceFormatterPart(parts, "hour");
  const minute = readMaintenanceFormatterPart(parts, "minute");
  const second = readMaintenanceFormatterPart(parts, "second");
  const milliseconds = readMaintenanceFormatterPart(
    parts,
    "fractionalSecond",
  );
  const datePart = `${year}-${month}-${day}`;
  const timePart = `${hour}:${minute}`;

  if (second === "00" && milliseconds === "000") {
    return `${datePart}T${timePart}`;
  }

  return `${datePart}T${timePart}:${second}`;
}

const SHANGHAI_DATE_TIME_LOCAL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  calendar: "gregory",
  day: "2-digit",
  fractionalSecondDigits: 3,
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  second: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

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

function readMaintenanceFormatterPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error("计划发送时间无法按 Asia/Shanghai 格式化。");
  }

  return part.value;
}

function readMaintenanceVersion(value: Record<string, unknown>) {
  const version = value.version;

  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version <= 0
  ) {
    throw new MaintenanceInputError("通知版本号必须是正的安全整数。");
  }

  return version;
}

function isMaintenanceNoticeSummary(
  value: unknown,
): value is MaintenanceNoticeSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.version === "number" &&
    typeof value.attemptCount === "number" &&
    Array.isArray(value.groupIds) &&
    isRecord(value.aggregate)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
