import { scryptSync } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTypeScriptModule, toDataUrl } from "./typescript-modules.mjs";

const nextServerUrl = new URL("../../node_modules/next/server.js", import.meta.url).href;

const { NextRequest } = await import(nextServerUrl);

export { NextRequest };

export const TEST_ORIGIN = "http://localhost:3000";
export const TEST_USERNAME = "admin";
export const TEST_PASSWORD = "correct-horse-battery-staple";
export const TEST_SECURE_ORIGIN = "https://console.example.com";
export const TEST_PASSWORD_SALT = "00112233445566778899aabbccddeeff";
export const TEST_BACKEND_TOKEN = "synthetic-backend-token";

export const TEST_PASSWORD_HASH = createPasswordHash(TEST_PASSWORD);

const builtinImports = {
  "node:crypto": "node:crypto",
  "node:fs": "node:fs",
  "node:path": "node:path",
  "node:sqlite": "node:sqlite",
};

const databaseSetupUrl = loadTypeScriptModule(
  "src/lib/server/database.ts",
  builtinImports,
);
const databaseSetup = await import(databaseSetupUrl);

export function createPasswordHash(password, saltHex = TEST_PASSWORD_SALT) {
  const digest = scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    64,
    { N: 16384, p: 1, r: 8 },
  ).toString("hex");

  return `scrypt$${saltHex}$${digest}`;
}

export function createAuthModuleUrls({ marker = "" } = {}) {
  const suffix = marker ? `#${marker}` : "";
  const databaseUrl =
    loadTypeScriptModule("src/lib/server/database.ts", builtinImports) + suffix;
  const passwordUrl =
    loadTypeScriptModule("src/lib/server/password.ts", builtinImports) + suffix;
  const adminAccountUrl =
    loadTypeScriptModule("src/lib/server/admin-account.ts", {
      ...builtinImports,
      "./database": databaseUrl,
      "./password": passwordUrl,
    }) + suffix;
  const configUrl =
    loadTypeScriptModule("src/lib/server/auth-config.ts", {
      ...builtinImports,
      "./admin-account": adminAccountUrl,
    }) + suffix;
  const authUrl = loadTypeScriptModule("src/lib/server/auth.ts", {
    ...builtinImports,
    "./auth-config": configUrl,
    "./database": databaseUrl,
    "./password": passwordUrl,
    "next/server": nextServerUrl,
  });
  const loginUrl = loadTypeScriptModule("src/app/api/auth/login/route.ts", {
    "@/lib/server/auth": authUrl,
    "next/server": nextServerUrl,
  });
  const logoutUrl = loadTypeScriptModule("src/app/api/auth/logout/route.ts", {
    "@/lib/server/auth": authUrl,
    "next/server": nextServerUrl,
  });
  const sessionUrl = loadTypeScriptModule("src/app/api/auth/session/route.ts", {
    "@/lib/server/auth": authUrl,
    "next/server": nextServerUrl,
  });
  const dismissReminderUrl = loadTypeScriptModule(
    "src/app/api/auth/initial-password-reminder/dismiss/route.ts",
    {
      "@/lib/server/auth": authUrl,
      "next/server": nextServerUrl,
    },
  );

  return {
    adminAccountUrl,
    authUrl,
    configUrl,
    databaseUrl,
    dismissReminderUrl,
    loginUrl,
    logoutUrl,
    passwordUrl,
    sessionUrl,
  };
}

export async function loadAuthRoutes(options) {
  const urls = createAuthModuleUrls(options);
  const auth = await import(urls.authUrl);
  const login = await import(urls.loginUrl);
  const logout = await import(urls.logoutUrl);
  const session = await import(urls.sessionUrl);
  const dismissReminder = await import(urls.dismissReminderUrl);

  return {
    authorizeConsoleRequest: auth.authorizeConsoleRequest,
    dismissReminderRoute: dismissReminder,
    getConsoleSession: auth.getConsoleSession,
    loginRoute: login,
    logoutRoute: logout,
    sessionRoute: session,
    urls,
  };
}

export function runtimeConfigSource({
  apiOrigin = "http://backend.test",
  bearerToken = TEST_BACKEND_TOKEN,
} = {}) {
  return `
    export async function getRuntimeConfig() {
      return {
        apiOrigin: ${JSON.stringify(apiOrigin)},
        bearerToken: ${JSON.stringify(bearerToken)},
        openapiUrl: "",
      };
    }
  `;
}

export function failingRuntimeConfigSource(message) {
  return `
    export async function getRuntimeConfig() {
      throw new Error(${JSON.stringify(message)});
    }
  `;
}

export async function loadProxyRoute({ runtimeConfig, marker = "" } = {}) {
  const { authUrl } = createAuthModuleUrls();
  const configUrl = toDataUrl(
    runtimeConfig ?? runtimeConfigSource(),
  );
  const proxyUrl =
    loadTypeScriptModule("src/app/api/proxy/[...path]/route.ts", {
      "@/lib/server/auth": authUrl,
      "@/lib/server/runtime-config": configUrl,
      "next/server": nextServerUrl,
    }) + (marker ? `#${marker}` : "");

  return import(proxyUrl);
}

export async function createTestDatabasePath() {
  const tmpRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
  await mkdir(tmpRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tmpRoot, "auth-test-"));
  return { databasePath: path.join(directory, "console.sqlite"), directory };
}

/**
 * Configure credential-independent environment values and seed a deterministic
 * administrator account when the database has none. Repeating this call for the
 * same database keeps the existing account and sessions intact.
 */
export async function configureAuthEnv({
  databasePath,
  origin = TEST_ORIGIN,
  passwordHash = TEST_PASSWORD_HASH,
  username = TEST_USERNAME,
  isRandomInitialPassword = 0,
  reminderDismissed = 1,
} = {}) {
  process.env.CONSOLE_PUBLIC_ORIGIN = origin;
  process.env.CONSOLE_DATABASE_PATH = databasePath;

  const database = databaseSetup.openConsoleDatabase(databasePath);

  try {
    const now = Date.now();
    database
      .prepare(
        `INSERT OR IGNORE INTO console_admin_account
          (id, username, password_hash, is_random_initial_password,
           reminder_dismissed, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        username,
        passwordHash,
        isRandomInitialPassword ? 1 : 0,
        reminderDismissed ? 1 : 0,
        now,
        now,
      );
  } finally {
    database.close();
  }
}

/** Replace the stored administrator credential for credential-change tests. */
export async function writeConsoleAdminAccount({
  databasePath,
  passwordHash = TEST_PASSWORD_HASH,
  username = TEST_USERNAME,
  isRandomInitialPassword = 0,
  reminderDismissed = 1,
}) {
  const database = databaseSetup.openConsoleDatabase(databasePath);

  try {
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO console_admin_account
          (id, username, password_hash, is_random_initial_password,
           reminder_dismissed, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           password_hash = excluded.password_hash,
           is_random_initial_password = excluded.is_random_initial_password,
           reminder_dismissed = excluded.reminder_dismissed,
           updated_at = excluded.updated_at`,
      )
      .run(
        username,
        passwordHash,
        isRandomInitialPassword ? 1 : 0,
        reminderDismissed ? 1 : 0,
        now,
        now,
      );
  } finally {
    database.close();
  }
}

export function clearAuthEnv() {
  delete process.env.CONSOLE_ADMIN_USERNAME;
  delete process.env.CONSOLE_ADMIN_PASSWORD_HASH;
  delete process.env.CONSOLE_PUBLIC_ORIGIN;
  delete process.env.CONSOLE_DATABASE_PATH;
}

export function loginRequest(
  loginRoute,
  {
    body,
    cookie,
    origin = TEST_ORIGIN,
    password = TEST_PASSWORD,
    username = TEST_USERNAME,
  } = {},
) {
  const headers = { "content-type": "application/json" };
  if (cookie) {
    headers.cookie = cookie;
  }
  if (origin !== null) {
    headers.origin = origin;
  }

  return loginRoute.POST(
    new NextRequest(`${TEST_ORIGIN}/api/auth/login`, {
      body: body ?? JSON.stringify({ password, username }),
      headers,
      method: "POST",
    }),
  );
}

export function sessionCookie(response) {
  const setCookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  assertSetCookie(setCookie);
  return setCookie.split(";")[0].trim();
}

export function sessionToken(response) {
  const cookie = sessionCookie(response);
  return cookie.slice(cookie.indexOf("=") + 1);
}

export function sessionGet(sessionRoute, cookie) {
  return sessionRoute.GET(
    new NextRequest(`${TEST_ORIGIN}/api/auth/session`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

export function dismissReminderRequest(
  dismissReminderRoute,
  cookie,
  { body, origin = TEST_ORIGIN } = {},
) {
  const headers = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  if (origin !== null) {
    headers.origin = origin;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  return dismissReminderRoute.POST(
    new NextRequest(
      `${TEST_ORIGIN}/api/auth/initial-password-reminder/dismiss`,
      {
        body,
        headers,
        method: "POST",
      },
    ),
  );
}

export function logoutRequest(logoutRoute, cookie, { origin = TEST_ORIGIN } = {}) {
  const headers = {};
  if (cookie) {
    headers.cookie = cookie;
  }
  if (origin !== null) {
    headers.origin = origin;
  }
  return logoutRoute.POST(
    new NextRequest(`${TEST_ORIGIN}/api/auth/logout`, { headers, method: "POST" }),
  );
}

export function proxyRequestUrl(pathname = "/api/v2/komari-knowledge/knowledge") {
  return `${TEST_ORIGIN}/api/proxy${pathname}`;
}

export function proxyContext(path = ["api", "v2", "komari-knowledge", "knowledge"]) {
  return { params: Promise.resolve({ path }) };
}

function assertSetCookie(setCookie) {
  if (!setCookie || typeof setCookie !== "string") {
    throw new Error("Expected a Set-Cookie response header");
  }
}
