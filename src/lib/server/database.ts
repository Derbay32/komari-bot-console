import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Shared SQLite handle for server-only console state. Future features can reuse
 * the same opener so the process keeps a single connection per database file.
 */
export type ConsoleDatabase = DatabaseSync;

const databases = new Map<string, DatabaseSync>();
const OPEN_LOCK_BUDGET_MS = 5_000;
const OPEN_RETRY_DELAY_MS = 100;
const NORMAL_BUSY_TIMEOUT_MS = 5_000;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

const consoleSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS console_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    credential_fingerprint TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS console_login_attempts (
    scope TEXT PRIMARY KEY NOT NULL,
    failures INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS console_admin_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT,
    is_random_initial_password INTEGER NOT NULL
      CHECK (is_random_initial_password IN (0, 1)),
    reminder_dismissed INTEGER NOT NULL
      CHECK (reminder_dismissed IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
];

export function getConsoleDatabase(databasePath: string) {
  const existing = databases.get(databasePath);
  if (existing) {
    return existing;
  }

  const database = openConsoleDatabase(databasePath);
  databases.set(databasePath, database);
  return database;
}

/**
 * Open the console database and apply the idempotent schema. Call this from
 * runtime code such as the Web startup hook or request handlers; builds must
 * not create database files.
 *
 * Concurrent startup can return SQLITE_BUSY while another process enables WAL
 * or creates the schema. Retry those transient locks within one bounded wait
 * so a sustained lock cannot multiply SQLite's busy timeout indefinitely.
 */
export function openConsoleDatabase(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const deadline = performance.now() + OPEN_LOCK_BUDGET_MS;

  for (;;) {
    let database: DatabaseSync | undefined;

    try {
      database = new DatabaseSync(databasePath);
      database.exec("PRAGMA foreign_keys = ON;");
      applyBusyBudget(database, deadline);
      database.exec("PRAGMA journal_mode = WAL;");

      for (const statement of consoleSchemaStatements) {
        applyBusyBudget(database, deadline);
        database.exec(statement);
      }

      database.exec(`PRAGMA busy_timeout = ${NORMAL_BUSY_TIMEOUT_MS};`);
      return database;
    } catch (error) {
      closeQuietly(database);
      const remaining = deadline - performance.now();

      if (!isDatabaseBusy(error) || remaining <= 0) {
        throw error;
      }

      Atomics.wait(
        sleepBuffer,
        0,
        0,
        Math.max(1, Math.min(OPEN_RETRY_DELAY_MS, Math.ceil(remaining))),
      );
    }
  }
}

function applyBusyBudget(database: DatabaseSync, deadline: number) {
  const remaining = Math.max(1, Math.floor(deadline - performance.now()));
  database.exec(`PRAGMA busy_timeout = ${remaining};`);
}

function isDatabaseBusy(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errcode = Reflect.get(error, "errcode");
  return errcode === 5 || errcode === 6;
}

function closeQuietly(database: DatabaseSync | undefined) {
  try {
    database?.close();
  } catch {
    // Retry with a fresh handle; the failed handle is no longer used.
  }
}
