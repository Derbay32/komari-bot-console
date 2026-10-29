import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { createRequestId } from "../../http/audit";
import {
  buildMaintenanceAggregate,
  MAINTENANCE_AUDIT_REASON,
  MaintenanceConflictError,
  type MaintenanceAttempt,
  type MaintenanceAttemptPhase,
  type MaintenanceAttemptTotals,
  type MaintenanceCreateInput,
  type MaintenanceNotice,
  type MaintenanceNoticeStatus,
  type MaintenanceNoticeSummary,
  type MaintenanceOutcome,
  type MaintenanceTargetEvidence,
  type MaintenanceUpstreamRequestBody,
} from "../../maintenance";
import { openConsoleDatabase } from "../database";
import {
  ensureMaintenanceSchema,
  MAINTENANCE_LEASE_MS,
} from "./schema";

const CONFLICT_MESSAGE = "提交标识已被不同的通知内容使用。";

export function openMaintenanceDatabase(databasePath: string) {
  const database = openConsoleDatabase(databasePath);

  try {
    ensureMaintenanceSchema(database);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

export function insertNoticeWithQueuedAttempt(
  database: DatabaseSync,
  input: MaintenanceCreateInput,
  submissionId: string,
  now: number,
) {
  const fingerprint = createInputFingerprint(input);

  database.exec("BEGIN IMMEDIATE");

  try {
    const existing = database
      .prepare(
        `SELECT id, input_fingerprint
         FROM maintenance_notices
         WHERE submission_id = ?`,
      )
      .get(submissionId);

    if (existing) {
      if (readString(existing, "input_fingerprint") !== fingerprint) {
        throw new MaintenanceConflictError(CONFLICT_MESSAGE);
      }

      database.exec("COMMIT");

      return { created: false, id: readString(existing, "id") };
    }

    const noticeId = randomUUID();
    const attemptId = randomUUID();
    const groupIdsJson = JSON.stringify(input.groupIds);
    const requestBody = createUpstreamRequestBody(input);

    database
      .prepare(
        `INSERT INTO maintenance_notices
          (id, submission_id, input_fingerprint, title, content,
           maintenance_time, target_group_ids, mode, planned_at, status,
           version, created_at, updated_at, started_at, ended_at,
           last_executed_attempt_ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', 1, ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        noticeId,
        submissionId,
        fingerprint,
        input.title,
        input.content,
        input.maintenanceTime,
        groupIdsJson,
        input.mode,
        input.plannedAt,
        now,
        now,
      );

    database
      .prepare(
        `INSERT INTO maintenance_attempts
          (id, notice_id, attempt_number, request_id, audit_reason, body_json,
           target_group_ids, phase, executed, started_at, ended_at,
           request_error, remaining_seconds, requires_reconciliation,
           owner_token, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, 'queued', 0, NULL, NULL,
                 NULL, NULL, 0, NULL, NULL, ?, ?)`,
      )
      .run(
        attemptId,
        noticeId,
        createRequestId("maint"),
        MAINTENANCE_AUDIT_REASON,
        JSON.stringify(requestBody),
        groupIdsJson,
        now,
        now,
      );

    database.exec("COMMIT");

    return { created: true, id: noticeId };
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

export function listNoticeSummaries(database: DatabaseSync) {
  return withReadTransaction(database, () => {
    const rows = database
      .prepare("SELECT * FROM maintenance_notices")
      .all();

    return rows.map((row) => readNoticeRecord(database, row).summary);
  });
}

export function readNotice(
  database: DatabaseSync,
  id: string,
): MaintenanceNotice | null {
  return withReadTransaction(database, () => {
    const row = database
      .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
      .get(id);

    if (!row) {
      return null;
    }

    const record = readNoticeRecord(database, row);

    return { ...record.summary, attempts: record.attempts };
  });
}

export function readNoticeSummary(
  database: DatabaseSync,
  id: string,
): MaintenanceNoticeSummary {
  return withReadTransaction(database, () => {
    const row = database
      .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
      .get(id);

    if (!row) {
      throw new Error("维护通知记录不存在。");
    }

    return readNoticeRecord(database, row).summary;
  });
}

export type ClaimedMaintenanceAttempt = {
  noticeId: string;
  attemptId: string;
  requestId: string;
  auditReason: string;
  requestBody: MaintenanceUpstreamRequestBody;
  targetGroupIds: number[];
  ownerToken: string;
};

export function claimQueuedAttempt(
  database: DatabaseSync,
  now: number,
): ClaimedMaintenanceAttempt | null {
  database.exec("BEGIN IMMEDIATE");

  try {
    const row = database
      .prepare(
        `SELECT a.id, a.notice_id, a.request_id, a.audit_reason,
                a.body_json, a.target_group_ids
         FROM maintenance_attempts AS a
         JOIN maintenance_notices AS n ON n.id = a.notice_id
         WHERE a.phase = 'queued'
           AND n.mode = 'immediate'
           AND n.planned_at IS NULL
           AND n.status IN ('upcoming', 'sent')
         ORDER BY a.created_at ASC, a.attempt_number ASC
         LIMIT 1`,
      )
      .get();

    if (!row) {
      database.exec("COMMIT");
      return null;
    }

    const attemptId = readString(row, "id");
    const noticeId = readString(row, "notice_id");
    const ownerToken = randomUUID();

    const claim = database
      .prepare(
        `UPDATE maintenance_attempts
         SET phase = 'running',
             owner_token = ?,
             lease_expires_at = ?,
             started_at = COALESCE(started_at, ?),
             updated_at = ?
         WHERE id = ? AND phase = 'queued'`,
      )
      .run(ownerToken, now + MAINTENANCE_LEASE_MS, now, now, attemptId);

    if (Number(claim.changes) !== 1) {
      database.exec("COMMIT");
      return null;
    }

    database
      .prepare(
        `UPDATE maintenance_notices
         SET status = 'sent',
             started_at = COALESCE(started_at, ?),
             updated_at = ?,
             version = version + 1
         WHERE id = ?`,
      )
      .run(now, now, noticeId);

    database.exec("COMMIT");

    return {
      attemptId,
      auditReason: readString(row, "audit_reason"),
      noticeId,
      ownerToken,
      requestBody: parseRequestBody(readString(row, "body_json")),
      requestId: readString(row, "request_id"),
      targetGroupIds: parseNumberArray(readString(row, "target_group_ids")),
    };
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

export function renewAttemptLease(
  database: DatabaseSync,
  options: {
    attemptId: string;
    ownerToken: string;
    leaseExpiresAt: number;
  },
) {
  database
    .prepare(
      `UPDATE maintenance_attempts
       SET lease_expires_at = ?
       WHERE id = ? AND owner_token = ? AND phase = 'running'`,
    )
    .run(
      options.leaseExpiresAt,
      options.attemptId,
      options.ownerToken,
    );
}

export type MaintenanceAttemptCompletion = {
  attemptId: string;
  noticeId: string;
  ownerToken: string;
  executed: boolean;
  results: MaintenanceTargetEvidence[];
  requestError: string | null;
  remainingSeconds: number | null;
  requiresReconciliation: boolean;
  endedAt: number;
};

export function completeAttempt(
  database: DatabaseSync,
  completion: MaintenanceAttemptCompletion,
) {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = database
      .prepare(
        `SELECT owner_token, phase
         FROM maintenance_attempts
         WHERE id = ?`,
      )
      .get(completion.attemptId);

    if (
      !current ||
      readString(current, "phase") !== "running" ||
      readNullableString(current, "owner_token") !== completion.ownerToken
    ) {
      throw new Error("维护尝试已失去执行权。");
    }

    database
      .prepare(
        `UPDATE maintenance_attempts
         SET phase = 'completed',
             executed = ?,
             ended_at = ?,
             request_error = ?,
             remaining_seconds = ?,
             requires_reconciliation = ?,
             owner_token = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        completion.executed ? 1 : 0,
        completion.endedAt,
        completion.requestError,
        completion.remainingSeconds,
        completion.requiresReconciliation ? 1 : 0,
        completion.endedAt,
        completion.attemptId,
      );

    database
      .prepare("DELETE FROM maintenance_attempt_results WHERE attempt_id = ?")
      .run(completion.attemptId);

    const insertResult = database.prepare(
      `INSERT INTO maintenance_attempt_results
        (attempt_id, group_id, position, outcome, reason, error_code, error,
         bot_id, requires_reconciliation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    completion.results.forEach((result, position) => {
      insertResult.run(
        completion.attemptId,
        result.groupId,
        position,
        result.outcome,
        result.reason,
        result.errorCode,
        result.error,
        result.botId,
        result.requiresReconciliation ? 1 : 0,
      );
    });

    database
      .prepare(
        `UPDATE maintenance_notices
         SET ended_at = ?,
             updated_at = ?,
             version = version + 1,
             last_executed_attempt_ended_at =
               CASE WHEN ? = 1 THEN ? ELSE last_executed_attempt_ended_at END
         WHERE id = ?`,
      )
      .run(
        completion.endedAt,
        completion.endedAt,
        completion.executed ? 1 : 0,
        completion.endedAt,
        completion.noticeId,
      );

    database.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

function readNoticeRecord(
  database: DatabaseSync,
  row: Record<string, SQLOutputValue>,
) {
  const id = readString(row, "id");
  const attempts = readAttempts(database, id);
  const groupIds = parseNumberArray(readString(row, "target_group_ids"));
  const aggregate = buildMaintenanceAggregate(
    groupIds,
    attempts.map((attempt) => ({
      executed: attempt.executed,
      phase: attempt.phase,
      remainingSeconds: attempt.remainingSeconds,
      requestError: attempt.requestError,
      requiresReconciliation: attempt.requiresReconciliation,
      results: attempt.results,
      targetGroupIds: attempt.targetGroupIds,
    })),
  );
  const latestAttempt =
    attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
  const activity =
    latestAttempt && latestAttempt.phase !== "completed"
      ? latestAttempt.phase
      : null;

  const summary: MaintenanceNoticeSummary = {
    activity,
    aggregate,
    attemptCount: attempts.length,
    content: readString(row, "content"),
    createdAt: readNumber(row, "created_at"),
    endedAt: readNullableNumber(row, "ended_at"),
    groupIds,
    id,
    lastExecutedAttemptEndedAt: readNullableNumber(
      row,
      "last_executed_attempt_ended_at",
    ),
    maintenanceTime: readString(row, "maintenance_time"),
    mode: readMode(row),
    plannedAt: readNullableNumber(row, "planned_at"),
    startedAt: readNullableNumber(row, "started_at"),
    status: readStatus(row),
    title: readString(row, "title"),
    updatedAt: readNumber(row, "updated_at"),
    version: readNumber(row, "version"),
  };

  return { attempts, summary };
}

function readAttempts(database: DatabaseSync, noticeId: string) {
  const attemptRows = database
    .prepare(
      `SELECT * FROM maintenance_attempts
       WHERE notice_id = ?
       ORDER BY attempt_number ASC`,
    )
    .all(noticeId);

  return attemptRows.map((row) => {
    const attemptId = readString(row, "id");
    const resultRows = database
      .prepare(
        `SELECT * FROM maintenance_attempt_results
         WHERE attempt_id = ?
         ORDER BY position ASC`,
      )
      .all(attemptId);
    const results = resultRows.map(readResult);
    const targetGroupIds = parseNumberArray(
      readString(row, "target_group_ids"),
    );

    return {
      auditReason: readString(row, "audit_reason"),
      endedAt: readNullableNumber(row, "ended_at"),
      executed: readNumber(row, "executed") === 1,
      id: attemptId,
      noticeId,
      number: readNumber(row, "attempt_number"),
      phase: readPhase(row),
      remainingSeconds: readNullableNumber(row, "remaining_seconds"),
      requestBody: parseRequestBody(readString(row, "body_json")),
      requestError: readNullableString(row, "request_error"),
      requestId: readString(row, "request_id"),
      requiresReconciliation:
        readNumber(row, "requires_reconciliation") === 1,
      results,
      startedAt: readNullableNumber(row, "started_at"),
      targetGroupIds,
      totals: calculateTotals(targetGroupIds, results),
    } satisfies MaintenanceAttempt;
  });
}

function readResult(row: Record<string, SQLOutputValue>): MaintenanceTargetEvidence {
  return {
    botId: readNullableString(row, "bot_id"),
    error: readNullableString(row, "error"),
    errorCode: readNullableString(row, "error_code"),
    groupId: readNumber(row, "group_id"),
    outcome: readOutcome(row),
    reason: readString(row, "reason"),
    requiresReconciliation:
      readNumber(row, "requires_reconciliation") === 1,
  };
}

function calculateTotals(
  targetGroupIds: readonly number[],
  results: readonly MaintenanceTargetEvidence[],
): MaintenanceAttemptTotals {
  const totals: MaintenanceAttemptTotals = {
    failed: 0,
    success: 0,
    total: targetGroupIds.length,
    unknown: 0,
    unreachable: 0,
  };
  const snapshot = new Set(targetGroupIds);

  for (const result of results) {
    if (snapshot.has(result.groupId)) {
      totals[result.outcome] += 1;
    }
  }

  return totals;
}

function createInputFingerprint(input: MaintenanceCreateInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        content: input.content,
        groupIds: input.groupIds,
        maintenanceTime: input.maintenanceTime,
        mode: input.mode,
        plannedAt: input.plannedAt,
        title: input.title,
      }),
    )
    .digest("hex");
}

function createUpstreamRequestBody(
  input: MaintenanceCreateInput,
): MaintenanceUpstreamRequestBody {
  return {
    content: input.content,
    group_ids: [...input.groupIds],
    scheduled_time: input.maintenanceTime,
    title: input.title,
  };
}

function parseRequestBody(text: string): MaintenanceUpstreamRequestBody {
  const parsed: unknown = JSON.parse(text);

  if (!isRecord(parsed)) {
    throw new Error("维护尝试的请求体记录无效。");
  }

  const title = readUnknownString(parsed, "title");
  const content = readUnknownString(parsed, "content");
  const scheduledTime = readUnknownString(parsed, "scheduled_time");
  const groupIds = Reflect.get(parsed, "group_ids");

  return {
    content,
    group_ids: requirePositiveIntegerArray(
      groupIds,
      "维护尝试的请求体群号记录无效。",
    ),
    scheduled_time: scheduledTime,
    title,
  };
}

function parseNumberArray(text: string) {
  return requirePositiveIntegerArray(
    JSON.parse(text),
    "维护记录中的群号数组无效。",
  );
}

function requirePositiveIntegerArray(value: unknown, message: string) {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }

  return value.map((item) => {
    if (!isPositiveInteger(item)) {
      throw new Error(message);
    }

    return item;
  });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readUnknownString(
  value: Record<string, unknown>,
  key: string,
) {
  const field = value[key];

  if (typeof field !== "string") {
    throw new Error(`维护请求体字段 ${key} 无效。`);
  }

  return field;
}

function readMode(row: Record<string, SQLOutputValue>) {
  const value = readString(row, "mode");

  if (value !== "immediate" && value !== "scheduled") {
    throw new Error("维护通知的发送方式记录无效。");
  }

  return value;
}

function readStatus(row: Record<string, SQLOutputValue>) {
  const value = readString(row, "status");
  const statuses: MaintenanceNoticeStatus[] = [
    "upcoming",
    "sent",
    "missed",
    "canceled",
  ];

  if (!statuses.includes(value as MaintenanceNoticeStatus)) {
    throw new Error("维护通知的状态记录无效。");
  }

  return value as MaintenanceNoticeStatus;
}

function readPhase(row: Record<string, SQLOutputValue>) {
  const value = readString(row, "phase");
  const phases: MaintenanceAttemptPhase[] = ["queued", "running", "completed"];

  if (!phases.includes(value as MaintenanceAttemptPhase)) {
    throw new Error("维护尝试的阶段记录无效。");
  }

  return value as MaintenanceAttemptPhase;
}

function readOutcome(row: Record<string, SQLOutputValue>) {
  const value = readString(row, "outcome");
  const outcomes: MaintenanceOutcome[] = [
    "success",
    "failed",
    "unreachable",
    "unknown",
  ];

  if (!outcomes.includes(value as MaintenanceOutcome)) {
    throw new Error("维护尝试的结果记录无效。");
  }

  return value as MaintenanceOutcome;
}

function readString(row: Record<string, SQLOutputValue>, key: string) {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`维护记录字段 ${key} 不是文本。`);
  }

  return value;
}

function readNullableString(
  row: Record<string, SQLOutputValue>,
  key: string,
) {
  const value = row[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`维护记录字段 ${key} 不是文本。`);
  }

  return value;
}

function readNumber(row: Record<string, SQLOutputValue>, key: string) {
  const value = row[key];

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`维护记录字段 ${key} 不是数字。`);
}

function readNullableNumber(
  row: Record<string, SQLOutputValue>,
  key: string,
) {
  const value = row[key];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`维护记录字段 ${key} 不是数字。`);
}

function withReadTransaction<T>(
  database: DatabaseSync,
  read: () => T,
): T {
  database.exec("BEGIN");

  try {
    const result = read();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

function rollbackQuietly(database: DatabaseSync) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be closed; keep the original failure.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
