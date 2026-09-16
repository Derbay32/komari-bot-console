import { readFile } from "node:fs/promises";
import path from "node:path";

type LocalSecret = {
  swagger_url?: string;
  secret?: string;
};

const secretFilePath = path.join(process.cwd(), "secret.json");

let cachedLocalSecret: Promise<LocalSecret | null> | undefined;

export async function loadLocalSecret() {
  if (!cachedLocalSecret) {
    cachedLocalSecret = readSecretFile();
  }

  return cachedLocalSecret;
}

async function readSecretFile() {
  try {
    const raw = await readFile(secretFilePath, "utf8");
    return JSON.parse(raw) as LocalSecret;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}
