import { getConsoleDatabase } from "./database";
import {
  generateConsolePassword,
  hashConsolePassword,
  isConsolePasswordHash,
} from "./password";

const ADMIN_USERNAME = "admin";
const MAX_ADMIN_USERNAME_LENGTH = 128;

export const CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE =
  "控制台管理员账户不可用。";

export type ConsoleAdminAccount = {
  createdAt: number;
  isRandomInitialPassword: boolean;
  passwordHash: string;
  reminderDismissed: boolean;
  updatedAt: number;
  username: string;
};

export type ConsoleAdminInitialization =
  | { initialized: false }
  | { initialized: true; password: string; username: string };

type ConsoleAdminRow = {
  created_at: unknown;
  is_random_initial_password: unknown;
  password_hash: unknown;
  reminder_dismissed: unknown;
  updated_at: unknown;
  username: unknown;
};

/**
 * Read the persisted console administrator credential. Returns null only when
 * the account or its password is missing. Malformed nonempty credentials throw
 * a sanitized error so callers fail closed instead of resetting them.
 */
export function getConsoleAdminAccount(
  databasePath: string,
): ConsoleAdminAccount | null {
  try {
    const row = readAdminRow(getConsoleDatabase(databasePath));

    if (!row || isMissingPassword(row.password_hash)) {
      return null;
    }

    return parseAdminRow(row);
  } catch (error) {
    throw toAccountError(error);
  }
}

/**
 * Initialize the single console administrator account when its password is
 * missing. The candidate password is generated and hashed before the write
 * transaction, so concurrent instances commit at most once. The plaintext is
 * returned only to the winning caller and is never persisted.
 */
export async function initializeConsoleAdmin(
  databasePath: string,
): Promise<ConsoleAdminInitialization> {
  const database = getConsoleDatabase(databasePath);
  const snapshot = readAdminRow(database);

  if (snapshot && !isMissingPassword(snapshot.password_hash)) {
    parseAdminRow(snapshot);
    return { initialized: false };
  }

  let candidate: { password: string; passwordHash: string };

  try {
    const password = generateConsolePassword();
    candidate = {
      password,
      passwordHash: await hashConsolePassword(password),
    };
  } catch (error) {
    throw toAccountError(error);
  }

  try {
    database.exec("BEGIN IMMEDIATE");

    const current = readAdminRow(database);

    if (current && !isMissingPassword(current.password_hash)) {
      parseAdminRow(current);
      database.exec("ROLLBACK");
      return { initialized: false };
    }

    const now = Date.now();
    const createdAt = readCreatedAt(current) ?? now;

    database
      .prepare(
        `INSERT INTO console_admin_account
          (id, username, password_hash, is_random_initial_password,
           reminder_dismissed, created_at, updated_at)
         VALUES (1, ?, ?, 1, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           password_hash = excluded.password_hash,
           is_random_initial_password =
             excluded.is_random_initial_password,
           reminder_dismissed = excluded.reminder_dismissed,
           updated_at = excluded.updated_at`,
      )
      .run(ADMIN_USERNAME, candidate.passwordHash, createdAt, now);
    database.prepare("DELETE FROM console_sessions").run();
    database.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(database);
    throw toAccountError(error);
  }

  return {
    initialized: true,
    password: candidate.password,
    username: ADMIN_USERNAME,
  };
}

function readAdminRow(database: ReturnType<typeof getConsoleDatabase>) {
  return database
    .prepare(
      `SELECT username, password_hash, is_random_initial_password,
              reminder_dismissed, created_at, updated_at
       FROM console_admin_account
       WHERE id = 1`,
    )
    .get() as ConsoleAdminRow | undefined;
}

function isMissingPassword(value: unknown) {
  return value === null || value === undefined || value === "";
}

function parseAdminRow(row: ConsoleAdminRow): ConsoleAdminAccount {
  const passwordHash = row.password_hash;
  const username = row.username;

  if (
    typeof username !== "string" ||
    username.length === 0 ||
    username.length > MAX_ADMIN_USERNAME_LENGTH ||
    typeof passwordHash !== "string" ||
    !isConsolePasswordHash(passwordHash)
  ) {
    throw new ConsoleAdminAccountError();
  }

  const createdAt = parseTimestamp(row.created_at);
  const updatedAt = parseTimestamp(row.updated_at);

  return {
    createdAt,
    isRandomInitialPassword: parseFlag(row.is_random_initial_password),
    passwordHash,
    reminderDismissed: parseFlag(row.reminder_dismissed),
    updatedAt,
    username,
  };
}

function parseFlag(value: unknown) {
  const flag = Number(value);

  if (flag !== 0 && flag !== 1) {
    throw new ConsoleAdminAccountError();
  }

  return flag === 1;
}

function parseTimestamp(value: unknown) {
  const timestamp = Number(value);

  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new ConsoleAdminAccountError();
  }

  return timestamp;
}

function readCreatedAt(row: ConsoleAdminRow | undefined) {
  if (!row) {
    return null;
  }

  const timestamp = Number(row.created_at);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

function rollbackQuietly(database: ReturnType<typeof getConsoleDatabase>) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be closed; keep the original failure.
  }
}

function toAccountError(error: unknown) {
  return error instanceof ConsoleAdminAccountError
    ? error
    : new ConsoleAdminAccountError();
}

export class ConsoleAdminAccountError extends Error {
  constructor() {
    super(CONSOLE_ADMIN_ACCOUNT_UNAVAILABLE_MESSAGE);
    this.name = "ConsoleAdminAccountError";
  }
}
