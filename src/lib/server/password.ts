import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const CONSOLE_PASSWORD_BYTES = 24;
const CONSOLE_PASSWORD_SALT_BYTES = 16;
const SCRYPT_SALT_HEX_LENGTH = 32;
const SCRYPT_DIGEST_HEX_LENGTH = 128;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PARAMETERS = {
  N: 16384,
  p: 1,
  r: 8,
} as const;

const passwordHashPattern = new RegExp(
  `^scrypt\\$([0-9a-f]{${SCRYPT_SALT_HEX_LENGTH}})\\$([0-9a-f]{${SCRYPT_DIGEST_HEX_LENGTH}})$`,
);

export function isConsolePasswordHash(value: string) {
  return passwordHashPattern.test(value);
}

/** Generate a random console password with 192 bits of entropy. */
export function generateConsolePassword() {
  return randomBytes(CONSOLE_PASSWORD_BYTES).toString("base64url");
}

/** Hash a console password with a fresh random salt and the shared scrypt format. */
export async function hashConsolePassword(password: string) {
  const salt = randomBytes(CONSOLE_PASSWORD_SALT_BYTES);
  const digest = await deriveKey(password, salt);

  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

/**
 * Verify a candidate password against the configured scrypt hash. Malformed
 * input returns false without throwing and without skipping the derivation cost
 * when the hash itself is valid.
 */
export async function verifyConsolePassword(
  password: string,
  encodedHash: string,
) {
  const match = passwordHashPattern.exec(encodedHash);

  if (!match) {
    return false;
  }

  const salt = Buffer.from(match[1], "hex");
  const expected = Buffer.from(match[2], "hex");
  const actual = await deriveKey(password, salt);

  return timingSafeEqual(actual, expected);
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMETERS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key);
    });
  });
}
