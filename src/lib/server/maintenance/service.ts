import path from "node:path";

import {
  MAINTENANCE_MISSING_RESULT_REASON,
  MaintenanceInputError,
  parseMaintenanceCreateInput,
  validateMaintenanceSubmissionId,
  type MaintenanceCreateInput,
  type MaintenanceCreateResult,
  type MaintenanceNotice,
  type MaintenanceNoticeSummary,
  type MaintenanceRunResult,
  type MaintenanceService,
  type MaintenanceServiceOptions,
  type MaintenanceTargetEvidence,
  type MaintenanceUpstreamConfig,
  type MaintenanceUpstreamProvider,
} from "../../maintenance";
import {
  MAINTENANCE_HEARTBEAT_MS,
  MAINTENANCE_LEASE_MS,
} from "./schema";
import {
  claimQueuedAttempt,
  completeAttempt,
  insertNoticeWithQueuedAttempt,
  listNoticeSummaries,
  openMaintenanceDatabase,
  readNotice,
  readNoticeSummary,
  renewAttemptLease,
} from "./storage";
import {
  dispatchMaintenanceRequest,
  type MaintenanceExecutionOutcome,
} from "./transport";

/**
 * The single public maintenance business facade. HTTP handlers only create,
 * list, and read; the independent worker is the only caller of runOnce.
 */
export function createMaintenanceService(
  options: MaintenanceServiceOptions,
): MaintenanceService {
  if (!path.isAbsolute(options.databasePath)) {
    throw new Error("控制台数据库路径必须是绝对路径。");
  }

  const databasePath = options.databasePath;
  const now = options.now ?? Date.now;

  return {
    async create(input, submissionId) {
      const normalizedInput = parseMaintenanceCreateInput(input);
      const normalizedSubmissionId =
        validateMaintenanceSubmissionId(submissionId);
      const database = openMaintenanceDatabase(databasePath);

      try {
        const created = insertNoticeWithQueuedAttempt(
          database,
          normalizedInput,
          normalizedSubmissionId,
          now(),
        );

        return {
          created: created.created,
          notice: readNoticeSummary(database, created.id),
        };
      } finally {
        database.close();
      }
    },

    async list() {
      const database = openMaintenanceDatabase(databasePath);

      try {
        return sortNotices(listNoticeSummaries(database));
      } finally {
        database.close();
      }
    },

    async get(id) {
      const database = openMaintenanceDatabase(databasePath);

      try {
        return readNotice(database, id);
      } finally {
        database.close();
      }
    },

    async runOnce() {
      const upstream = await resolveUpstream(options.upstream);
      const database = openMaintenanceDatabase(databasePath);
      let claimed;

      try {
        claimed = claimQueuedAttempt(database, now());
      } catch (error) {
        database.close();
        throw error;
      }

      if (!claimed) {
        database.close();
        return { attemptId: null, noticeId: null, processed: false };
      }

      let heartbeat: ReturnType<typeof setInterval> | null = null;

      try {
        heartbeat = setInterval(() => {
          try {
            renewAttemptLease(database, {
              attemptId: claimed.attemptId,
              leaseExpiresAt: now() + MAINTENANCE_LEASE_MS,
              ownerToken: claimed.ownerToken,
            });
          } catch {
            // A failed heartbeat does not cancel the in-flight request. The
            // persisted lease records the last successful renewal.
          }
        }, MAINTENANCE_HEARTBEAT_MS);

        let outcome: MaintenanceExecutionOutcome;

        try {
          outcome = await dispatchMaintenanceRequest({
            auditReason: claimed.auditReason,
            requestBody: claimed.requestBody,
            requestId: claimed.requestId,
            targetGroupIds: claimed.targetGroupIds,
            upstream,
          });
        } catch {
          outcome = uncertainTransportOutcome(claimed.targetGroupIds);
        }

        completeAttempt(database, {
          attemptId: claimed.attemptId,
          endedAt: now(),
          executed: outcome.executed,
          noticeId: claimed.noticeId,
          ownerToken: claimed.ownerToken,
          remainingSeconds: outcome.remainingSeconds,
          requestError: outcome.requestError,
          requiresReconciliation: outcome.requiresReconciliation,
          results: outcome.results,
        });

        return {
          attemptId: claimed.attemptId,
          noticeId: claimed.noticeId,
          processed: true,
        };
      } finally {
        if (heartbeat) {
          clearInterval(heartbeat);
        }

        database.close();
      }
    },
  };
}

function sortNotices(notices: MaintenanceNoticeSummary[]) {
  const upcoming = notices.filter((notice) => notice.status === "upcoming");
  const history = notices.filter((notice) => notice.status !== "upcoming");

  upcoming.sort(
    (left, right) =>
      (left.plannedAt ?? left.createdAt) -
      (right.plannedAt ?? right.createdAt),
  );
  history.sort(
    (left, right) =>
      (right.lastExecutedAttemptEndedAt ??
        right.startedAt ??
        right.createdAt) -
      (left.lastExecutedAttemptEndedAt ?? left.startedAt ?? left.createdAt),
  );

  return [...upcoming, ...history];
}

async function resolveUpstream(
  provider: MaintenanceUpstreamProvider,
): Promise<MaintenanceUpstreamConfig> {
  const config =
    typeof provider === "function" ? await provider() : provider;

  if (!config || typeof config.apiOrigin !== "string" || !config.apiOrigin.trim()) {
    throw new Error("缺少维护通知上游地址配置。");
  }

  if (!config.bearerToken?.trim()) {
    throw new Error("缺少维护通知上游 Bearer Token 配置。");
  }

  let url: URL;

  try {
    url = new URL(config.apiOrigin);
  } catch {
    throw new Error("维护通知上游地址格式无效。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("维护通知上游地址必须使用 HTTP 或 HTTPS。");
  }

  if (url.username || url.password) {
    throw new Error("维护通知上游地址不能包含用户信息。");
  }

  return {
    apiOrigin: url.origin,
    bearerToken: config.bearerToken.trim(),
  };
}

function uncertainTransportOutcome(
  targetGroupIds: readonly number[],
): MaintenanceExecutionOutcome {
  const results: MaintenanceTargetEvidence[] = targetGroupIds.map(
    (groupId) => ({
      botId: null,
      error: null,
      errorCode: null,
      groupId,
      outcome: "unknown",
      reason: MAINTENANCE_MISSING_RESULT_REASON,
      requiresReconciliation: true,
    }),
  );

  return {
    executed: true,
    remainingSeconds: null,
    requestError: "上游请求失败，结果未知。",
    requiresReconciliation: true,
    results,
  };
}

export type {
  MaintenanceCreateInput,
  MaintenanceCreateResult,
  MaintenanceNotice,
  MaintenanceNoticeSummary,
  MaintenanceRunResult,
  MaintenanceService,
  MaintenanceServiceOptions,
};

export { MaintenanceInputError };
