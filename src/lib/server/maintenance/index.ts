/**
 * Public maintenance facade. Import this module from server routes and the
 * independent worker; keep storage, dispatch, and transport internal.
 */
export { createMaintenanceService } from "./service";

export type {
  MaintenanceAttempt,
  MaintenanceAttemptPhase,
  MaintenanceAttemptTotals,
  MaintenanceCreateInput,
  MaintenanceCreateResult,
  MaintenanceMode,
  MaintenanceNotice,
  MaintenanceNoticeAggregate,
  MaintenanceNoticeStatus,
  MaintenanceNoticeSummary,
  MaintenanceOutcome,
  MaintenanceRetryInput,
  MaintenanceRetryPreview,
  MaintenanceRetryResult,
  MaintenanceRunResult,
  MaintenanceService,
  MaintenanceServiceOptions,
  MaintenanceTargetEvidence,
  MaintenanceUpstreamConfig,
  MaintenanceUpstreamRequestBody,
} from "../../maintenance";
