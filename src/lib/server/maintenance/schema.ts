import type { DatabaseSync } from "node:sqlite";

export const MAINTENANCE_LEASE_MS = 30_000;
export const MAINTENANCE_HEARTBEAT_MS = 5_000;

/**
 * Create the maintenance tables in the existing console database. The schema is
 * idempotent and only runs from request-time or worker code.
 */
export function ensureMaintenanceSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_notices (
      id TEXT PRIMARY KEY NOT NULL,
      submission_id TEXT NOT NULL UNIQUE,
      input_fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      maintenance_time TEXT NOT NULL,
      target_group_ids TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('immediate', 'scheduled')),
      planned_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('upcoming', 'sent', 'missed', 'canceled')),
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      last_executed_attempt_ended_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS maintenance_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      notice_id TEXT NOT NULL REFERENCES maintenance_notices(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      audit_reason TEXT NOT NULL,
      body_json TEXT NOT NULL,
      target_group_ids TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('queued', 'running', 'completed')),
      executed INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      ended_at INTEGER,
      request_error TEXT,
      remaining_seconds REAL,
      requires_reconciliation INTEGER NOT NULL DEFAULT 0,
      owner_token TEXT,
      lease_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (notice_id, attempt_number)
    );

    CREATE TABLE IF NOT EXISTS maintenance_attempt_results (
      attempt_id TEXT NOT NULL REFERENCES maintenance_attempts(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed', 'unreachable', 'unknown')),
      reason TEXT NOT NULL,
      error_code TEXT,
      error TEXT,
      bot_id TEXT,
      requires_reconciliation INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (attempt_id, group_id)
    );

    CREATE INDEX IF NOT EXISTS maintenance_attempts_phase_idx
      ON maintenance_attempts (phase, created_at);
    CREATE INDEX IF NOT EXISTS maintenance_attempts_notice_idx
      ON maintenance_attempts (notice_id, attempt_number);
    CREATE INDEX IF NOT EXISTS maintenance_results_attempt_idx
      ON maintenance_attempt_results (attempt_id, position);
  `);
}
