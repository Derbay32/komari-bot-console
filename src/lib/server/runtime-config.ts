import { loadLocalSecret } from "./local-secret";

type RuntimeConfig = {
  apiOrigin: string;
  bearerToken: string;
  openapiUrl: string;
};

let cachedRuntimeConfig: Promise<RuntimeConfig> | undefined;

export async function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    cachedRuntimeConfig = resolveRuntimeConfig();
  }

  return cachedRuntimeConfig;
}

async function resolveRuntimeConfig() {
  const localSecret = await loadLocalSecret();
  const swaggerUrl = localSecret?.swagger_url?.trim() ?? "";
  const apiOrigin = process.env.KOMARI_API_ORIGIN?.trim() || deriveOrigin(swaggerUrl);
  const bearerToken =
    process.env.KOMARI_API_BEARER_TOKEN?.trim() || localSecret?.secret?.trim() || "";
  const openapiUrl =
    process.env.KOMARI_OPENAPI_URL?.trim() || deriveOpenapiUrl(swaggerUrl);

  if (!apiOrigin) {
    throw new Error("缺少 KOMARI_API_ORIGIN，且无法从 secret.json 推导后端地址。");
  }

  if (!bearerToken) {
    throw new Error("缺少 Bearer Token，请在环境变量或 secret.json 中提供。");
  }

  return {
    apiOrigin,
    bearerToken,
    openapiUrl,
  };
}

function deriveOrigin(swaggerUrl: string) {
  if (!swaggerUrl) {
    return "";
  }

  return new URL(swaggerUrl).origin;
}

function deriveOpenapiUrl(swaggerUrl: string) {
  if (!swaggerUrl) {
    return "";
  }

  const url = new URL(swaggerUrl);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/docs\/?$/, "/openapi.json");
  return url.toString();
}
