import path from "node:path";

import { isConsolePasswordHash } from "./password";

export const CONSOLE_CONFIG_UNAVAILABLE_MESSAGE = "控制台认证配置不可用。";

const MAX_CONFIG_USERNAME_LENGTH = 128;

export type ConsoleAuthConfig = {
  databasePath: string;
  passwordHash: string;
  publicOrigin: string;
  username: string;
};

/**
 * Read console authentication configuration from server process environment.
 * Every value is required; malformed input fails closed without echoing values.
 */
export function getConsoleAuthConfig(): ConsoleAuthConfig {
  const username = process.env.CONSOLE_ADMIN_USERNAME?.trim() ?? "";
  const passwordHash = process.env.CONSOLE_ADMIN_PASSWORD_HASH ?? "";
  const publicOrigin = process.env.CONSOLE_PUBLIC_ORIGIN?.trim() ?? "";
  const databasePath = process.env.CONSOLE_DATABASE_PATH?.trim() ?? "";

  if (
    !username ||
    username.length > MAX_CONFIG_USERNAME_LENGTH ||
    !isConsolePasswordHash(passwordHash)
  ) {
    throw new ConsoleConfigError();
  }

  return {
    databasePath: parseDatabasePath(databasePath),
    passwordHash,
    publicOrigin: parsePublicOrigin(publicOrigin),
    username,
  };
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
