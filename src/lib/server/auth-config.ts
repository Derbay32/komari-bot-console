import path from "node:path";

import {
  getConsoleAdminAccount,
  type ConsoleAdminAccount,
} from "./admin-account";

export const CONSOLE_CONFIG_UNAVAILABLE_MESSAGE = "控制台认证配置不可用。";

export type ConsoleAuthConfig = {
  databasePath: string;
  isRandomInitialPassword: boolean;
  passwordHash: string;
  publicOrigin: string;
  reminderDismissed: boolean;
  username: string;
};

export type ConsoleAuthEnvironment = {
  databasePath: string;
  publicOrigin: string;
};

/**
 * Read console authentication configuration. Environment values are validated
 * on every call, and the administrator credential is read from SQLite so
 * changed or damaged credentials take effect immediately.
 */
export function getConsoleAuthConfig(): ConsoleAuthConfig {
  const environment = getConsoleAuthEnvironment();
  let account: ConsoleAdminAccount | null;

  try {
    account = getConsoleAdminAccount(environment.databasePath);
  } catch {
    throw new ConsoleConfigError();
  }

  if (!account) {
    throw new ConsoleConfigError();
  }

  return {
    databasePath: environment.databasePath,
    isRandomInitialPassword: account.isRandomInitialPassword,
    passwordHash: account.passwordHash,
    publicOrigin: environment.publicOrigin,
    reminderDismissed: account.reminderDismissed,
    username: account.username,
  };
}

/** Validate and return the credential-independent bootstrap configuration. */
export function getConsoleAuthEnvironment(): ConsoleAuthEnvironment {
  const publicOrigin = process.env.CONSOLE_PUBLIC_ORIGIN?.trim() ?? "";
  const databasePath = process.env.CONSOLE_DATABASE_PATH?.trim() ?? "";

  return {
    databasePath: parseDatabasePath(databasePath),
    publicOrigin: parsePublicOrigin(publicOrigin),
  };
}

/** Return the validated database path for credential maintenance commands. */
export function getConsoleDatabasePath(): string {
  return parseDatabasePath(process.env.CONSOLE_DATABASE_PATH?.trim() ?? "");
}

export class ConsoleConfigError extends Error {
  constructor() {
    super(CONSOLE_CONFIG_UNAVAILABLE_MESSAGE);
    this.name = "ConsoleConfigError";
  }
}

function parsePublicOrigin(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ConsoleConfigError();
  }

  const isLocalHostname =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  const hasAllowedProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && isLocalHostname);

  if (
    !hasAllowedProtocol ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new ConsoleConfigError();
  }

  return url.origin;
}

function parseDatabasePath(value: string) {
  if (!value || !path.isAbsolute(value) || value.endsWith(path.sep)) {
    throw new ConsoleConfigError();
  }

  return value;
}
