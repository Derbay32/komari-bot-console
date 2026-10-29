import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { createRequestId } from "../../http/audit";
import {
  buildMaintenanceAggregate,
  MAINTENANCE_AUDIT_REASON,
  MAINTENANCE_CANCELED_REASON,
  MAINTENANCE_INTERRUPTED_REASON,
  MAINTENANCE_MISSED_REASON,
  MAINTENANCE_RETRY_AUDIT_REASON,
  MAINTENANCE_SCHEDULED_START_WINDOW_MS,
  MaintenanceConflictError,
  MaintenanceInputError,
  MaintenanceNotFoundError,
  type MaintenanceAttempt,
  type MaintenanceAttemptPhase,
  type MaintenanceAttemptTotals,
  type MaintenanceCreateInput,
  type MaintenanceNotice,
  type MaintenanceNoticeStatus,
  type MaintenanceNoticeSummary,
  type MaintenanceOutcome,
  type MaintenanceRetryInput,
  type MaintenanceRetryPreview,
  type MaintenanceTargetEvidence,
  type MaintenanceUpdateInput,
  type MaintenanceUpstreamRequestBody,
} from "../../maintenance";
import { openConsoleDatabase } from "../database";
import {
  ensureMaintenanceSchema,
  MAINTENANCE_LEASE_MS,
} from "./schema";

const CONFLICT_MESSAGE = "提交标识已被不同的通知内容使用。";
const RETRY_SUBMISSION_CONFLICT_MESSAGE =
  "重试提交标识已被不同的重试请求使用。";
const RETRY_VERSION_CONFLICT_MESSAGE =
  "通知已更新，需重新获取重试名单。";
const RETRY_LIST_CONFLICT_MESSAGE =
  "可重试目标群已变化，需重新获取重试名单。";
const RETRY_BUSY_REASON = "通知存在排队或执行中的尝试时不能手动重试。";
const RETRY_NOT_SENT_REASON = "只有状态为已发送的通知支持手动重试失败群。";
const RETRY_NO_TARGETS_REASON =
  "没有可重试的目标群。成功、结果未知和需人工核对的目标不会进入重试名单。";

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
  nowProvider: () => number,
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

    const now = nowProvider();

    if (
      input.mode === "scheduled" &&
      (input.plannedAt === null || input.plannedAt <= now)
    ) {
      throw new MaintenanceInputError("计划发送时间必须晚于当前时刻。");
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

export function readRetryPreview(
  database: DatabaseSync,
  id: string,
): MaintenanceRetryPreview | null {
  return withReadTransaction(database, () => {
    const row = database
      .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
      .get(id);

    if (!row) {
      return null;
    }

    const record = readNoticeRecord(database, row);

    return buildRetryPreview(record.summary, record.attempts);
  });
}

function buildRetryPreview(
  summary: MaintenanceNoticeSummary,
  attempts: readonly MaintenanceAttempt[],
): MaintenanceRetryPreview {
  const busy = attempts.some((attempt) => attempt.phase !== "completed");
  const targetGroupIds =
    summary.status === "sent" && !busy
      ? summary.aggregate.perGroup
          .filter(isRetryEligibleTarget)
          .map((target) => target.groupId)
      : [];
  let blockedReason: string | null = null;

  if (targetGroupIds.length === 0) {
    blockedReason = busy
      ? RETRY_BUSY_REASON
      : summary.status !== "sent"
        ? RETRY_NOT_SENT_REASON
        : RETRY_NO_TARGETS_REASON;
  }

  return {
    blockedReason,
    content: summary.content,
    maintenanceTime: summary.maintenanceTime,
    noticeId: summary.id,
    targetGroupIds,
    title: summary.title,
    version: summary.version,
  };
}

function isRetryEligibleTarget(target: {
  outcome: MaintenanceOutcome | null;
  retryBlocked: boolean;
  requiresReconciliation: boolean;
}) {
  return (
    (target.outcome === "failed" || target.outcome === "unreachable") &&
    !target.retryBlocked &&
    !target.requiresReconciliation
  );
}

export type MaintenanceRetryEnqueueResult = {
  noticeId: string;
  attemptId: string;
  created: boolean;
};

/**
 * Enqueue one manual retry attempt. The submission receipt is checked before
 * any eligibility read so a local replay returns the original attempt even
 * after the notice or its results changed. A first-time key must match the
 * current notice version and the exact ordered eligible target list.
 */
export function enqueueRetry(
  database: DatabaseSync,
  noticeId: string,
  input: MaintenanceRetryInput,
  submissionId: string,
  now: number,
): MaintenanceRetryEnqueueResult {
  const fingerprint = createRetryFingerprint(noticeId, input);

  database.exec("BEGIN IMMEDIATE");

  try {
    const receipt = database
      .prepare(
        `SELECT notice_id, attempt_id, fingerprint
         FROM maintenance_retry_submissions
         WHERE submission_key = ?`,
      )
      .get(submissionId);

    if (receipt) {
      if (
        readString(receipt, "notice_id") !== noticeId ||
        readString(receipt, "fingerprint") !== fingerprint
      ) {
        throw new MaintenanceConflictError(RETRY_SUBMISSION_CONFLICT_MESSAGE);
      }

      database.exec("COMMIT");

      return {
        attemptId: readString(receipt, "attempt_id"),
        created: false,
        noticeId,
      };
    }

    const row = database
      .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
      .get(noticeId);

    if (!row) {
      throw new MaintenanceNotFoundError("通知不存在。");
    }

    const record = readNoticeRecord(database, row);
    const preview = buildRetryPreview(record.summary, record.attempts);

    if (record.summary.version !== input.version) {
      throw new MaintenanceConflictError(RETRY_VERSION_CONFLICT_MESSAGE);
    }

    if (!hasSameOrderedGroupIds(preview.targetGroupIds, input.groupIds)) {
      throw new MaintenanceConflictError(RETRY_LIST_CONFLICT_MESSAGE);
    }

    const nextNumberRow = database
      .prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_number
         FROM maintenance_attempts
         WHERE notice_id = ?`,
      )
      .get(noticeId);
    const attemptNumber = readNumber(nextNumberRow ?? {}, "next_number");
    const attemptId = randomUUID();
    const targetGroupIdsJson = JSON.stringify(input.groupIds);
    const requestBody: MaintenanceUpstreamRequestBody = {
      content: record.summary.content,
      group_ids: [...input.groupIds],
      scheduled_time: record.summary.maintenanceTime,
      title: record.summary.title,
    };

    database
      .prepare(
        `INSERT INTO maintenance_attempts
          (id, notice_id, attempt_number, request_id, audit_reason, body_json,
           target_group_ids, phase, executed, started_at, ended_at,
           request_error, remaining_seconds, requires_reconciliation,
           owner_token, lease_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL,
                 NULL, NULL, 0, NULL, NULL, ?, ?)`,
      )
      .run(
        attemptId,
        noticeId,
        attemptNumber,
        createRequestId("maint"),
        MAINTENANCE_RETRY_AUDIT_REASON,
        JSON.stringify(requestBody),
        targetGroupIdsJson,
        now,
        now,
      );

    database
      .prepare(
        `UPDATE maintenance_notices
         SET version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, noticeId);

    database
      .prepare(
        `INSERT INTO maintenance_retry_submissions
          (submission_key, notice_id, attempt_id, fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(submissionId, noticeId, attemptId, fingerprint, now);

    database.exec("COMMIT");

    return { attemptId, created: true, noticeId };
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

function createRetryFingerprint(
  noticeId: string,
  input: MaintenanceRetryInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        groupIds: input.groupIds,
        noticeId,
        version: input.version,
      }),
    )
    .digest("hex");
}

function hasSameOrderedGroupIds(
  left: readonly number[],
  right: readonly number[],
) {
  return (
    left.length === right.length &&
    left.every((groupId, index) => groupId === right[index])
  );
}

/**
 * Replace an unclaimed notice's editable fields and the queued attempt's
 * target snapshot in one write transaction. The submission receipt, request
 * id, attempt identity, and audit reason stay intact; the version is the
 * optimistic concurrency token.
 */
export function updateQueuedNotice(
  database: DatabaseSync,
  id: string,
  input: MaintenanceUpdateInput,
  nowProvider: () => number,
): MaintenanceNoticeSummary | null {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = readNoticeRecordForWrite(database, id);

    if (!current) {
      database.exec("COMMIT");
      return null;
    }

    assertNoticeEditable(current, input.version, "编辑");

    const now = nowProvider();

    if (
      input.mode === "scheduled" &&
      (input.plannedAt === null || input.plannedAt <= now)
    ) {
      throw new MaintenanceInputError("计划发送时间必须晚于当前时刻。");
    }

    const groupIdsJson = JSON.stringify(input.groupIds);
    const requestBody = createUpstreamRequestBody(input);
    const noticeChanges = database
      .prepare(
        `UPDATE maintenance_notices
         SET title = ?,
             content = ?,
             maintenance_time = ?,
             target_group_ids = ?,
             mode = ?,
             planned_at = ?,
             version = version + 1,
             updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        input.title,
        input.content,
        input.maintenanceTime,
        groupIdsJson,
        input.mode,
        input.plannedAt,
        now,
        id,
        input.version,
      );

    if (Number(noticeChanges.changes) !== 1) {
      throw new MaintenanceConflictError(
        "通知已被更新，请刷新后重试。",
        current.summary,
      );
    }

    const attemptChanges = database
      .prepare(
        `UPDATE maintenance_attempts
         SET body_json = ?,
             target_group_ids = ?,
             updated_at = ?
         WHERE notice_id = ? AND attempt_number = 1 AND phase = 'queued'`,
      )
      .run(JSON.stringify(requestBody), groupIdsJson, now, id);

    if (Number(attemptChanges.changes) !== 1) {
      throw new MaintenanceConflictError(
        "当前状态不允许编辑该通知。",
        current.summary,
      );
    }

    const summary = readNoticeSummaryRow(database, id);
    database.exec("COMMIT");

    return summary;
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

/**
 * Cancel an unclaimed notice in one write transaction. The original plan and
 * target snapshot remain for history; the queued attempt is closed without
 * results and never touches the upstream.
 */
export function cancelQueuedNotice(
  database: DatabaseSync,
  id: string,
  version: number,
  nowProvider: () => number,
): MaintenanceNoticeSummary | null {
  database.exec("BEGIN IMMEDIATE");

  try {
    const current = readNoticeRecordForWrite(database, id);

    if (!current) {
      database.exec("COMMIT");
      return null;
    }

    assertNoticeEditable(current, version, "取消");

    const now = nowProvider();
    const attempt = current.attempts[0];
    const noticeChanges = database
      .prepare(
        `UPDATE maintenance_notices
         SET status = 'canceled',
             ended_at = ?,
             updated_at = ?,
             version = version + 1
         WHERE id = ? AND version = ? AND status = 'upcoming'`,
      )
      .run(now, now, id, version);

    if (Number(noticeChanges.changes) !== 1 || !attempt) {
      throw new MaintenanceConflictError(
        "当前状态不允许取消该通知。",
        current.summary,
      );
    }

    const attemptChanges = database
      .prepare(
        `UPDATE maintenance_attempts
         SET phase = 'completed',
             executed = 0,
             ended_at = ?,
             request_error = ?,
             remaining_seconds = NULL,
             requires_reconciliation = 0,
             owner_token = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND phase = 'queued'`,
      )
      .run(now, MAINTENANCE_CANCELED_REASON, now, attempt.id);

    if (Number(attemptChanges.changes) !== 1) {
      throw new MaintenanceConflictError(
        "当前状态不允许取消该通知。",
        current.summary,
      );
    }

    database
      .prepare("DELETE FROM maintenance_attempt_results WHERE attempt_id = ?")
      .run(attempt.id);

    const summary = readNoticeSummaryRow(database, id);
    database.exec("COMMIT");

    return summary;
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

function readNoticeRecordForWrite(database: DatabaseSync, id: string) {
  const row = database
    .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
    .get(id);

  if (!row) {
    return null;
  }

  return readNoticeRecord(database, row);
}

function readNoticeSummaryRow(database: DatabaseSync, id: string) {
  const row = database
    .prepare("SELECT * FROM maintenance_notices WHERE id = ?")
    .get(id);

  if (!row) {
    throw new Error("维护通知记录不存在。");
  }

  return readNoticeRecord(database, row).summary;
}

function assertNoticeEditable(
  record: ReturnType<typeof readNoticeRecord>,
  expectedVersion: number,
  action: string,
) {
  if (record.summary.version !== expectedVersion) {
    throw new MaintenanceConflictError(
      "通知已被更新，请刷新后重试。",
      record.summary,
    );
  }

  const [attempt] = record.attempts;
  const editable =
    record.summary.status === "upcoming" &&
    record.summary.startedAt === null &&
    record.attempts.length === 1 &&
    attempt?.number === 1 &&
    attempt.phase === "queued" &&
    attempt.startedAt === null;

  if (!editable) {
    throw new MaintenanceConflictError(
      `当前状态不允许${action}该通知。`,
      record.summary,
    );
  }
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
  nowProvider: () => number,
): ClaimedMaintenanceAttempt | null {
  database.exec("BEGIN IMMEDIATE");

  try {
    const now = nowProvider();
    const row = database
      .prepare(
        `SELECT a.id, a.notice_id, a.request_id, a.audit_reason,
                a.body_json, a.target_group_ids
         FROM maintenance_attempts AS a
         JOIN maintenance_notices AS n ON n.id = a.notice_id
         WHERE a.phase = 'queued'
           AND (
             (n.mode = 'immediate'
              AND n.planned_at IS NULL
              AND n.status IN ('upcoming', 'sent'))
             OR (n.mode = 'scheduled'
                 AND a.attempt_number = 1
                 AND n.status = 'upcoming'
                 AND n.planned_at IS NOT NULL
                 AND n.planned_at <= ?
                 AND ? <= n.planned_at + ?)
             OR (a.attempt_number > 1 AND n.status = 'sent')
           )
         ORDER BY a.created_at ASC, a.attempt_number ASC
         LIMIT 1`,
      )
      .get(now, now, MAINTENANCE_SCHEDULED_START_WINDOW_MS);

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

export function recoverExpiredRunningAttempts(
  database: DatabaseSync,
  nowProvider: () => number,
) {
  database.exec("BEGIN IMMEDIATE");

  try {
    const now = nowProvider();
    const rows = database
      .prepare(
        `SELECT id, notice_id, owner_token, target_group_ids
         FROM maintenance_attempts
         WHERE phase = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= ?
         ORDER BY created_at ASC, attempt_number ASC`,
      )
      .all(now);
    const recover = database.prepare(
      `UPDATE maintenance_attempts
       SET phase = 'completed',
           executed = 1,
           ended_at = ?,
           request_error = ?,
           remaining_seconds = NULL,
           requires_reconciliation = 1,
           owner_token = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND phase = 'running'
         AND owner_token IS ?
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at <= ?`,
    );
    const updateNotice = database.prepare(
      `UPDATE maintenance_notices
       SET ended_at = ?,
           updated_at = ?,
           version = version + 1,
           last_executed_attempt_ended_at = ?
       WHERE id = ?`,
    );
    let recovered = 0;

    for (const row of rows) {
      const attemptId = readString(row, "id");
      const noticeId = readString(row, "notice_id");
      const ownerToken = readNullableString(row, "owner_token");
      const changes = recover.run(
        now,
        MAINTENANCE_INTERRUPTED_REASON,
        now,
        attemptId,
        ownerToken,
        now,
      );

      if (Number(changes.changes) !== 1) {
        continue;
      }

      const targetGroupIds = parseNumberArray(
        readString(row, "target_group_ids"),
      );

      database
        .prepare("DELETE FROM maintenance_attempt_results WHERE attempt_id = ?")
        .run(attemptId);
      insertAttemptResults(
        database,
        attemptId,
        targetGroupIds.map((groupId) => ({
          botId: null,
          error: null,
          errorCode: null,
          groupId,
          outcome: "unknown",
          reason: MAINTENANCE_INTERRUPTED_REASON,
          requiresReconciliation: true,
        })),
      );
      updateNotice.run(now, now, now, noticeId);
      recovered += 1;
    }

    database.exec("COMMIT");

    return recovered;
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

export function expireMissedScheduledAttempts(
  database: DatabaseSync,
  nowProvider: () => number,
) {
  database.exec("BEGIN IMMEDIATE");

  try {
    const now = nowProvider();
    const rows = database
      .prepare(
        `SELECT a.id, a.notice_id
         FROM maintenance_attempts AS a
         JOIN maintenance_notices AS n ON n.id = a.notice_id
         WHERE a.phase = 'queued'
           AND a.attempt_number = 1
           AND n.mode = 'scheduled'
           AND n.status = 'upcoming'
           AND n.planned_at IS NOT NULL
           AND ? > n.planned_at + ?
         ORDER BY n.planned_at ASC, a.created_at ASC`,
      )
      .all(now, MAINTENANCE_SCHEDULED_START_WINDOW_MS);
    const closeAttempt = database.prepare(
      `UPDATE maintenance_attempts
       SET phase = 'completed',
           executed = 0,
           ended_at = ?,
           request_error = ?,
           remaining_seconds = NULL,
           requires_reconciliation = 0,
           owner_token = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE id = ? AND phase = 'queued'`,
    );
    const markNoticeMissed = database.prepare(
      `UPDATE maintenance_notices
       SET status = 'missed',
           ended_at = ?,
           updated_at = ?,
           version = version + 1
       WHERE id = ? AND status = 'upcoming'`,
    );
    let missed = 0;

    for (const row of rows) {
      const attemptId = readString(row, "id");
      const noticeId = readString(row, "notice_id");
      const changes = closeAttempt.run(
        now,
        MAINTENANCE_MISSED_REASON,
        now,
        attemptId,
      );

      if (Number(changes.changes) !== 1) {
        continue;
      }

      database
        .prepare("DELETE FROM maintenance_attempt_results WHERE attempt_id = ?")
        .run(attemptId);
      markNoticeMissed.run(now, now, noticeId);
      missed += 1;
    }

    database.exec("COMMIT");

    return missed;
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

    insertAttemptResults(database, completion.attemptId, completion.results);

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

function insertAttemptResults(
  database: DatabaseSync,
  attemptId: string,
  results: readonly MaintenanceTargetEvidence[],
) {
  const insertResult = database.prepare(
    `INSERT INTO maintenance_attempt_results
      (attempt_id, group_id, position, outcome, reason, error_code, error,
       bot_id, requires_reconciliation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  results.forEach((result, position) => {
    insertResult.run(
      attemptId,
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
