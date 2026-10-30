import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import {
  CONSOLE_CONFIG_UNAVAILABLE_MESSAGE,
  ConsoleConfigError,
  getConsoleAuthConfig,
  type ConsoleAuthConfig,
} from "./auth-config";
import { getConsoleDatabase } from "./database";
import { verifyConsolePassword } from "./password";

export const CONSOLE_SESSION_COOKIE_NAME = "komari_console_session";
export const CONSOLE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_LOGIN_BODY_BYTES = 4096;
const MAX_LOGIN_USERNAME_LENGTH = 128;
const MAX_LOGIN_PASSWORD_LENGTH = 1024;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const LOGIN_ATTEMPT_SCOPE = "admin";
// Wire marker mirrored by src/lib/http/client.ts.
const CONSOLE_UNAUTHENTICATED_CODE = "CONSOLE_UNAUTHENTICATED";

const INVALID_CREDENTIALS_MESSAGE = "用户名或密码错误。";
const UNAUTHENTICATED_MESSAGE = "未登录或会话已过期。";
const ORIGIN_REJECTED_MESSAGE = "请求来源校验失败。";
const LOGIN_FAILED_MESSAGE = "登录失败，请稍后重试。";
const LOGIN_THROTTLED_MESSAGE = "登录尝试过于频繁，请稍后再试。";
const REMINDER_DISMISS_FAILED_MESSAGE = "保存提醒状态失败，请稍后重试。";

export type ConsoleAuthorization =
  | { authorized: true; username: string }
  | { authorized: false; response: Response };

/**
 * Authorize a console request for current and future protected API routes.
 * Unsafe methods require an exact same-origin Origin header before the stored
 * session is consulted.
 */
export async function authorizeConsoleRequest(
  request: Request,
): Promise<ConsoleAuthorization> {
  let config: ConsoleAuthConfig;

  try {
    config = getConsoleAuthConfig();
  } catch {
    return {
      authorized: false,
      response: configUnavailableResponse(),
    };
  }

  if (isUnsafeMethod(request.method) && !hasAcceptedOrigin(request, config)) {
    return {
      authorized: false,
      response: originRejectedResponse(),
    };
  }

  const token = readSessionToken(request.headers.get("cookie"));
  const session = token ? readSession(config, token) : null;

  if (!session) {
    return {
      authorized: false,
      response: unauthenticatedResponse(),
    };
  }

  return { authorized: true, username: session.username };
}

/** Resolve the current console session for server layouts. */
export async function getConsoleSession(cookieHeader: string | null) {
  const token = readSessionToken(cookieHeader);

  if (!token) {
    return null;
  }

  let config: ConsoleAuthConfig;

  try {
    config = getConsoleAuthConfig();
  } catch {
    return null;
  }

  return readSession(config, token);
}

export async function loginConsole(request: Request) {
  let config: ConsoleAuthConfig;

  try {
    config = getConsoleAuthConfig();
  } catch {
    return configUnavailableResponse();
  }

  if (!hasAcceptedOrigin(request, config)) {
    return originRejectedResponse();
  }

  let database: ReturnType<typeof getConsoleDatabase>;

  try {
    database = getConsoleDatabase(config.databasePath);
  } catch {
    return configUnavailableResponse();
  }

  let reservation: ReturnType<typeof reserveLoginAttempt>;

  try {
    reservation = reserveLoginAttempt(database, Date.now());
  } catch {
    return jsonResponse({ message: LOGIN_FAILED_MESSAGE }, 500);
  }

  if (!reservation.allowed) {
    return loginThrottledResponse(reservation.retryAfterSeconds);
  }

  let payload: Awaited<ReturnType<typeof readLoginPayload>>;

  try {
    payload = await readLoginPayload(request);
  } catch {
    releaseLoginReservation(database, reservation.windowStartedAt);
    return jsonResponse({ message: LOGIN_FAILED_MESSAGE }, 500);
  }

  if (!payload) {
    return invalidCredentialsResponse();
  }

  let passwordMatches: boolean;

  try {
    passwordMatches = await verifyConsolePassword(
      payload.password,
      config.passwordHash,
    );
  } catch {
    releaseLoginReservation(database, reservation.windowStartedAt);
    return jsonResponse({ message: LOGIN_FAILED_MESSAGE }, 500);
  }

  const usernameMatches = payload.username === config.username;

  if (!passwordMatches || !usernameMatches) {
    return invalidCredentialsResponse();
  }

  releaseLoginReservation(database, reservation.windowStartedAt);

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const previousToken = readSessionToken(request.headers.get("cookie"));
  const verifiedFingerprint = createCredentialFingerprint(config);
  let staleCredentials = false;

  try {
    database.exec("BEGIN IMMEDIATE");

    if (
      createCredentialFingerprint(getConsoleAuthConfig()) !==
      verifiedFingerprint
    ) {
      staleCredentials = true;
      database.exec("ROLLBACK");
    } else {
      database
        .prepare("DELETE FROM console_sessions WHERE expires_at <= ?")
        .run(now);

      if (previousToken) {
        database
          .prepare("DELETE FROM console_sessions WHERE token_hash = ?")
          .run(hashSessionToken(previousToken));
      }

      database
        .prepare(
          `INSERT INTO console_sessions
            (token_hash, username, expires_at, credential_fingerprint)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          hashSessionToken(token),
          config.username,
          now + CONSOLE_SESSION_TTL_MS,
          verifiedFingerprint,
        );
      database.exec("COMMIT");
    }
  } catch {
    rollbackQuietly(database);
    return jsonResponse({ message: LOGIN_FAILED_MESSAGE }, 500);
  }

  if (staleCredentials) {
    return invalidCredentialsResponse();
  }

  const response = jsonResponse({ username: config.username }, 200);
  setSessionCookie(response, token, config);
  return response;
}

export async function logoutConsole(request: Request) {
  let config: ConsoleAuthConfig;

  try {
    config = getConsoleAuthConfig();
  } catch {
    return configUnavailableResponse();
  }

  if (!hasAcceptedOrigin(request, config)) {
    return originRejectedResponse();
  }

  const token = readSessionToken(request.headers.get("cookie"));
  const session = token ? readSession(config, token) : null;

  if (!token || !session) {
    return unauthenticatedResponse();
  }

  try {
    getConsoleDatabase(config.databasePath)
      .prepare("DELETE FROM console_sessions WHERE token_hash = ?")
      .run(hashSessionToken(token));
  } catch {
    return jsonResponse({ message: LOGIN_FAILED_MESSAGE }, 500);
  }

  const response = jsonResponse({ ok: true }, 200);
  clearSessionCookie(response, config);
  return response;
}

export async function getSessionConsole(request: Request) {
  try {
    getConsoleAuthConfig();
  } catch {
    return configUnavailableResponse();
  }

  const session = await getConsoleSession(request.headers.get("cookie"));

  if (!session) {
    return unauthenticatedResponse();
  }

  return jsonResponse(
    {
      isRandomInitialPassword: session.isRandomInitialPassword,
      reminderDismissed: session.reminderDismissed,
      username: session.username,
    },
    200,
  );
}

/**
 * Persist the account-level initial-password reminder dismissal for the
 * current session. The credential and session are re-read inside the write
 * transaction so a credential change committed after login rejects the stale
 * session instead of disabling the replacement credential's reminder.
 */
export async function dismissInitialPasswordReminderConsole(
  request: Request,
) {
  let config: ConsoleAuthConfig;

  try {
    config = getConsoleAuthConfig();
  } catch {
    return configUnavailableResponse();
  }

  if (!hasAcceptedOrigin(request, config)) {
    return originRejectedResponse();
  }

  const token = readSessionToken(request.headers.get("cookie"));

  if (!token) {
    return unauthenticatedResponse();
  }

  let database: ReturnType<typeof getConsoleDatabase>;

  try {
    database = getConsoleDatabase(config.databasePath);
  } catch {
    return jsonResponse({ message: REMINDER_DISMISS_FAILED_MESSAGE }, 500);
  }

  let sessionCurrent = false;

  try {
    database.exec("BEGIN IMMEDIATE");

    // The write lock may wait for another writer, so read the clock only
    // after it succeeds and use that instant for TTL and persistence.
    const now = Date.now();
    const currentConfig = getConsoleAuthConfig();

    if (readSession(currentConfig, token, now)) {
      database
        .prepare(
          `UPDATE console_admin_account
           SET reminder_dismissed = 1, updated_at = ?
           WHERE id = 1 AND reminder_dismissed = 0`,
        )
        .run(now);
      sessionCurrent = true;
    }

    database.exec(sessionCurrent ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    rollbackQuietly(database);

    return error instanceof ConsoleConfigError
      ? configUnavailableResponse()
      : jsonResponse({ message: REMINDER_DISMISS_FAILED_MESSAGE }, 500);
  }

  if (!sessionCurrent) {
    return unauthenticatedResponse();
  }

  return jsonResponse({ reminderDismissed: true }, 200);
}

function reserveLoginAttempt(
  database: ReturnType<typeof getConsoleDatabase>,
  now: number,
) {
  database.exec("BEGIN IMMEDIATE");

  try {
    const row = database
      .prepare(
        `SELECT failures, window_started_at
         FROM console_login_attempts
         WHERE scope = ?`,
      )
      .get(LOGIN_ATTEMPT_SCOPE);
    const sameWindow =
      row !== undefined && now - Number(row.window_started_at) < LOGIN_WINDOW_MS;

    if (sameWindow && Number(row.failures) >= MAX_FAILED_LOGINS) {
      database.exec("COMMIT");
      return {
        allowed: false as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (Number(row.window_started_at) + LOGIN_WINDOW_MS - now) / 1000,
          ),
        ),
      };
    }

    const windowStartedAt = sameWindow ? Number(row.window_started_at) : now;
    const failures = (sameWindow ? Number(row.failures) : 0) + 1;

    database
      .prepare(
        `INSERT INTO console_login_attempts (scope, failures, window_started_at)
         VALUES (?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           failures = excluded.failures,
           window_started_at = excluded.window_started_at`,
      )
      .run(LOGIN_ATTEMPT_SCOPE, failures, windowStartedAt);
    database.exec("COMMIT");

    return { allowed: true as const, windowStartedAt };
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

/**
 * Return a reserved slot when a login succeeds so only failed attempts consume
 * the shared window. The update keeps the reservation count non-negative.
 */
function releaseLoginReservation(
  database: ReturnType<typeof getConsoleDatabase>,
  windowStartedAt: number,
) {
  try {
    database
      .prepare(
        `UPDATE console_login_attempts
         SET failures = MAX(failures - 1, 0)
         WHERE scope = ? AND window_started_at = ?`,
      )
      .run(LOGIN_ATTEMPT_SCOPE, windowStartedAt);
  } catch {
    // A stale reservation at worst delays the next login until the window ends.
  }
}

function rollbackQuietly(database: ReturnType<typeof getConsoleDatabase>) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The transaction may already be closed; keep the original failure.
  }
}

function readSession(
  config: ConsoleAuthConfig,
  token: string,
  now = Date.now(),
) {
  try {
    const database = getConsoleDatabase(config.databasePath);
    const row = database
      .prepare(
        `SELECT username, expires_at, credential_fingerprint
         FROM console_sessions
         WHERE token_hash = ?`,
      )
      .get(hashSessionToken(token));

    if (!row || Number(row.expires_at) <= now) {
      return null;
    }

    if (
      String(row.credential_fingerprint) !== createCredentialFingerprint(config)
    ) {
      return null;
    }

    return {
      isRandomInitialPassword: config.isRandomInitialPassword,
      reminderDismissed: config.reminderDismissed,
      username: String(row.username),
    };
  } catch {
    return null;
  }
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createCredentialFingerprint(config: ConsoleAuthConfig) {
  return createHash("sha256")
    .update(`${config.username}\u0000${config.passwordHash}`)
    .digest("hex");
}

function readSessionToken(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) {
      continue;
    }

    if (part.slice(0, separator).trim() !== CONSOLE_SESSION_COOKIE_NAME) {
      continue;
    }

    const token = part.slice(separator + 1).trim();
    return SESSION_TOKEN_PATTERN.test(token) ? token : null;
  }

  return null;
}

async function readLoginPayload(request: Request) {
  const text = await readBoundedText(request, MAX_LOGIN_BODY_BYTES);

  if (text === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const username = Reflect.get(parsed, "username");
  const password = Reflect.get(parsed, "password");

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username ||
    username.length > MAX_LOGIN_USERNAME_LENGTH ||
    !password ||
    password.length > MAX_LOGIN_PASSWORD_LENGTH
  ) {
    return null;
  }

  return { password, username };
}

async function readBoundedText(request: Request, limit: number) {
  const contentLength = request.headers.get("content-length");

  if (contentLength) {
    const declaredLength = Number(contentLength);

    if (!Number.isFinite(declaredLength) || declaredLength > limit) {
      return null;
    }
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalLength += value.byteLength;

    if (totalLength > limit) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function setSessionCookie(
  response: NextResponse,
  token: string,
  config: ConsoleAuthConfig,
) {
  response.cookies.set({
    httpOnly: true,
    maxAge: Math.floor(CONSOLE_SESSION_TTL_MS / 1000),
    name: CONSOLE_SESSION_COOKIE_NAME,
    path: "/",
    sameSite: "strict",
    secure: isSecureOrigin(config.publicOrigin),
    value: token,
  });
}

function clearSessionCookie(response: NextResponse, config: ConsoleAuthConfig) {
  response.cookies.set({
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    name: CONSOLE_SESSION_COOKIE_NAME,
    path: "/",
    sameSite: "strict",
    secure: isSecureOrigin(config.publicOrigin),
    value: "",
  });
}

function isSecureOrigin(origin: string) {
  return new URL(origin).protocol === "https:";
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function hasAcceptedOrigin(request: Request, config: ConsoleAuthConfig) {
  return request.headers.get("origin") === config.publicOrigin;
}

function jsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });
}

function configUnavailableResponse() {
  return jsonResponse({ message: CONSOLE_CONFIG_UNAVAILABLE_MESSAGE }, 500);
}

function invalidCredentialsResponse() {
  return jsonResponse({ message: INVALID_CREDENTIALS_MESSAGE }, 401);
}

function unauthenticatedResponse() {
  return jsonResponse(
    {
      code: CONSOLE_UNAUTHENTICATED_CODE,
      message: UNAUTHENTICATED_MESSAGE,
    },
    401,
  );
}

function originRejectedResponse() {
  return jsonResponse({ message: ORIGIN_REJECTED_MESSAGE }, 403);
}

function loginThrottledResponse(retryAfterSeconds: number) {
  const response = jsonResponse({ message: LOGIN_THROTTLED_MESSAGE }, 429);
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}
