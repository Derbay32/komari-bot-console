import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Shared SQLite handle for server-only console state. Future features can reuse
 * the same opener so the process keeps a single connection per database file.
 */
export type ConsoleDatabase = DatabaseSync;

const databases = new Map<string, DatabaseSync>();

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
 * Open the console database and apply the idempotent schema. Call this only
 * from request-time code; builds must not create database files.
 */
export function openConsoleDatabase(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS console_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      credential_fingerprint TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS console_login_attempts (
      scope TEXT PRIMARY KEY NOT NULL,
      failures INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL
    );
  `);

  return database;
}
