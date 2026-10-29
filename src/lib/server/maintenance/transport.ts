import { buildAuditHeaders } from "../../http/audit";
import {
  MAINTENANCE_MISSING_RESULT_REASON,
  MAINTENANCE_UPSTREAM_PATH,
  type MaintenanceTargetEvidence,
  type MaintenanceUpstreamConfig,
  type MaintenanceUpstreamRequestBody,
} from "../../maintenance";

export type MaintenanceExecutionOutcome = {
  executed: boolean;
  results: MaintenanceTargetEvidence[];
  requestError: string | null;
  remainingSeconds: number | null;
  requiresReconciliation: boolean;
};

type DispatchOptions = {
  upstream: MaintenanceUpstreamConfig;
  requestBody: MaintenanceUpstreamRequestBody;
  targetGroupIds: number[];
  requestId: string;
  auditReason: string;
};

/**
 * Send one persisted attempt to the upstream maintenance endpoint. Every
 * failure mode is converted into evidence; the caller must never re-send with
 * a fresh request id.
 */
export async function dispatchMaintenanceRequest(
  options: DispatchOptions,
): Promise<MaintenanceExecutionOutcome> {
  const url = new URL(MAINTENANCE_UPSTREAM_PATH, options.upstream.apiOrigin);
  let response: Response;

  try {
    response = await fetch(url, {
      body: JSON.stringify(options.requestBody),
      cache: "no-store",
      headers: {
        ...buildAuditHeaders(options.auditReason, options.requestId),
        authorization: `Bearer ${options.upstream.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "error",
    });
  } catch {
    return uncertainOutcome(
      options.targetGroupIds,
      "上游网络请求失败，结果未知。",
    );
  }

  let text: string;

  try {
    text = await response.text();
  } catch {
    return unreadableBodyOutcome(response.status, options.targetGroupIds);
  }

  const parsed = tryParseJson(text);
  const payload = parsed.ok ? parsed.value : null;

  if (response.status === 200) {
    if (!parsed.ok) {
      return uncertainOutcome(
        options.targetGroupIds,
        "上游响应不是有效 JSON，结果未知。",
      );
    }

    const results = normalizeUpstreamResults(payload, options.targetGroupIds);

    if (!results) {
      return uncertainOutcome(
        options.targetGroupIds,
        "上游响应格式无效，结果未知。",
      );
    }

    return {
      executed: true,
      remainingSeconds: null,
      requestError: null,
      requiresReconciliation: results.some(
        (result) => result.requiresReconciliation,
      ),
      results,
    };
  }

  if (response.status === 409) {
    return conflictOutcome(
      readDetailMessage(payload) ??
        "上游返回冲突（HTTP 409），需人工核对。",
      options.targetGroupIds,
    );
  }

  if (response.status === 429) {
    const throttle = readThrottleDetail(payload);

    return {
      executed: false,
      remainingSeconds: throttle.remainingSeconds,
      requestError: throttle.message ?? "请求过于频繁（HTTP 429）。",
      requiresReconciliation: false,
      results: [],
    };
  }

  if (response.status >= 400 && response.status < 500) {
    return {
      executed: false,
      remainingSeconds: null,
      requestError:
        readDetailMessage(payload) ?? `上游拒绝请求（HTTP ${response.status}）。`,
      requiresReconciliation: false,
      results: [],
    };
  }

  return uncertainOutcome(
    options.targetGroupIds,
    response.status >= 500
      ? `上游请求失败（HTTP ${response.status}），结果未知。`
      : `上游返回非预期状态（HTTP ${response.status}），结果未知。`,
  );
}

function normalizeUpstreamResults(
  payload: unknown,
  targetGroupIds: readonly number[],
): MaintenanceTargetEvidence[] | null {
  if (!isRecord(payload)) {
    return null;
  }

  const rawResults = payload.results;

  if (!Array.isArray(rawResults)) {
    return null;
  }

  const entriesByGroup = new Map<number, Record<string, unknown>[]>();

  for (const entry of rawResults) {
    if (!isRecord(entry)) {
      continue;
    }

    const groupId = entry.group_id;

    if (!isPositiveInteger(groupId)) {
      continue;
    }

    const entries = entriesByGroup.get(groupId) ?? [];
    entries.push(entry);
    entriesByGroup.set(groupId, entries);
  }

  return targetGroupIds.map((groupId) => {
    const entries = entriesByGroup.get(groupId) ?? [];

    if (entries.length === 0) {
      return missingResult(groupId);
    }

    if (entries.length > 1) {
      return unknownResult(groupId, "上游结果重复，结果未知");
    }

    return normalizeEntry(groupId, entries[0]);
  });
}

function normalizeEntry(
  groupId: number,
  entry: Record<string, unknown>,
): MaintenanceTargetEvidence {
  const success = entry.success;
  const status = entry.status;
  const errorCodeReading = readErrorCode(entry);
  const errorCode = errorCodeReading.value;
  const error = readOptionalString(entry, "error");
  const botId = readOptionalString(entry, "bot_id");
  const evidence = { botId, error, errorCode, groupId };

  if (errorCodeReading.present && !errorCodeReading.valid) {
    return {
      ...evidence,
      outcome: "unknown",
      reason: "上游结果无法识别，结果未知",
      requiresReconciliation: true,
    };
  }

  if (success === true) {
    if (status === "success" && errorCode === null) {
      return {
        ...evidence,
        outcome: "success",
        reason: "发送成功",
        requiresReconciliation: false,
      };
    }

    return {
      ...evidence,
      outcome: "unknown",
      reason: isRecognizedFailureEvidence(status, errorCode)
        ? "上游结果矛盾，结果未知"
        : "上游结果无法识别，结果未知",
      requiresReconciliation: true,
    };
  }

  if (success === false || success === undefined || success === null) {
    if (errorCode === "send_failed") {
      if (status === "success") {
        return {
          ...evidence,
          outcome: "unknown",
          reason: "上游结果矛盾，结果未知",
          requiresReconciliation: true,
        };
      }

      return {
        ...evidence,
        outcome: "failed",
        reason: "发送失败",
        requiresReconciliation: false,
      };
    }

    if (errorCode === "group_unreachable") {
      if (status === "success") {
        return {
          ...evidence,
          outcome: "unknown",
          reason: "上游结果矛盾，结果未知",
          requiresReconciliation: true,
        };
      }

      return {
        ...evidence,
        outcome: "unreachable",
        reason: "未调用平台发送",
        requiresReconciliation: false,
      };
    }

    if (errorCode === "delivery_unknown") {
      if (status === "success") {
        return {
          ...evidence,
          outcome: "unknown",
          reason: "上游结果矛盾，结果未知",
          requiresReconciliation: true,
        };
      }

      return {
        ...evidence,
        outcome: "unknown",
        reason: "投递结果未知，需人工核对",
        requiresReconciliation: true,
      };
    }

    if (status === "success") {
      return {
        ...evidence,
        outcome: "unknown",
        reason: "上游结果矛盾，结果未知",
        requiresReconciliation: true,
      };
    }

    return {
      ...evidence,
      outcome: "unknown",
      reason: "上游结果无法识别，结果未知",
      requiresReconciliation: true,
    };
  }

  return {
    ...evidence,
    outcome: "unknown",
    reason: "上游结果无法识别，结果未知",
    requiresReconciliation: true,
  };
}

function isRecognizedFailureEvidence(
  status: unknown,
  errorCode: string | null,
) {
  return (
    status === "success" ||
    status === "failed" ||
    status === "unreachable" ||
    errorCode === "send_failed" ||
    errorCode === "group_unreachable" ||
    errorCode === "delivery_unknown"
  );
}

function missingResult(groupId: number): MaintenanceTargetEvidence {
  return {
    botId: null,
    error: null,
    errorCode: null,
    groupId,
    outcome: "unknown",
    reason: MAINTENANCE_MISSING_RESULT_REASON,
    requiresReconciliation: true,
  };
}

function unknownResult(
  groupId: number,
  reason: string,
): MaintenanceTargetEvidence {
  return {
    botId: null,
    error: null,
    errorCode: null,
    groupId,
    outcome: "unknown",
    reason,
    requiresReconciliation: true,
  };
}

function unreadableBodyOutcome(
  status: number,
  targetGroupIds: readonly number[],
): MaintenanceExecutionOutcome {
  if (status === 409) {
    return conflictOutcome(
      "上游返回冲突（HTTP 409），需人工核对。",
      targetGroupIds,
    );
  }

  if (status === 429) {
    return {
      executed: false,
      remainingSeconds: null,
      requestError: "请求过于频繁（HTTP 429）。",
      requiresReconciliation: false,
      results: [],
    };
  }

  if (status >= 400 && status < 500) {
    return {
      executed: false,
      remainingSeconds: null,
      requestError: `上游拒绝请求（HTTP ${status}）。`,
      requiresReconciliation: false,
      results: [],
    };
  }

  return uncertainOutcome(
    targetGroupIds,
    status === 200
      ? "读取上游响应失败，结果未知。"
      : status >= 500
        ? `上游请求失败（HTTP ${status}），结果未知。`
        : `上游返回非预期状态（HTTP ${status}），结果未知。`,
  );
}

function conflictOutcome(
  detail: string,
  targetGroupIds: readonly number[],
): MaintenanceExecutionOutcome {
  const reason = `上游返回冲突，需人工核对：${detail}`;

  return {
    executed: false,
    remainingSeconds: null,
    requestError: detail,
    requiresReconciliation: true,
    results: targetGroupIds.map((groupId) => ({
      botId: null,
      error: null,
      errorCode: null,
      groupId,
      outcome: "unknown",
      reason,
      requiresReconciliation: true,
    })),
  };
}

function uncertainOutcome(
  targetGroupIds: readonly number[],
  requestError: string,
): MaintenanceExecutionOutcome {
  return {
    executed: true,
    remainingSeconds: null,
    requestError,
    requiresReconciliation: true,
    results: targetGroupIds.map(missingResult),
  };
}

function tryParseJson(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const, value: null };
  }
}

function readDetailMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const detail = payload.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (!isRecord(item)) {
        continue;
      }

      const message = item.msg ?? item.message;

      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  }

  if (isRecord(detail)) {
    const message = detail.message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  const message = payload.message;

  return typeof message === "string" && message.trim()
    ? message.trim()
    : null;
}

function readThrottleDetail(payload: unknown) {
  if (!isRecord(payload)) {
    return { message: null as string | null, remainingSeconds: null as number | null };
  }

  const detail = payload.detail;

  if (isRecord(detail)) {
    const message = detail.message;
    const remainingSeconds = detail.remaining_seconds;

    return {
      message:
        typeof message === "string" && message.trim()
          ? message.trim()
          : null,
      remainingSeconds:
        typeof remainingSeconds === "number" &&
        Number.isFinite(remainingSeconds)
          ? remainingSeconds
          : null,
    };
  }

  return {
    message: readDetailMessage(payload),
    remainingSeconds: null,
  };
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
) {
  const field = value[key];

  return typeof field === "string" && field.trim() ? field : null;
}

const RECOGNIZED_ERROR_CODES = new Set([
  "send_failed",
  "group_unreachable",
  "delivery_unknown",
]);

function readErrorCode(value: Record<string, unknown>) {
  const field = value.error_code;

  if (field === undefined || field === null) {
    return { present: false, valid: true, value: null };
  }

  if (typeof field !== "string") {
    return { present: true, valid: false, value: null };
  }

  if (!RECOGNIZED_ERROR_CODES.has(field)) {
    return { present: true, valid: false, value: field || null };
  }

  return { present: true, valid: true, value: field };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
