import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const schemaOutputPath = join(rootDir, "openapi", "komari-management.json");
const typesOutputPath = join(rootDir, "src", "types", "komari-api.d.ts");

async function main() {
  const secret = await readLocalSecret();
  const swaggerUrl = secret?.swagger_url?.trim() ?? "";
  const token = process.env.KOMARI_API_BEARER_TOKEN?.trim() || secret?.secret?.trim() || "";
  const openapiUrl =
    process.env.KOMARI_OPENAPI_URL?.trim() || deriveOpenapiUrl(swaggerUrl);

  if (!openapiUrl) {
    throw new Error("无法确定 OpenAPI 地址，请配置 KOMARI_OPENAPI_URL。");
  }

  const schemaText = await downloadOpenapiSchema(openapiUrl, token);
  await mkdir(dirname(schemaOutputPath), { recursive: true });
  await mkdir(dirname(typesOutputPath), { recursive: true });
  await writeFile(schemaOutputPath, schemaText, "utf8");
  await runOpenapiTypescript(schemaOutputPath, typesOutputPath);
  console.log(`OpenAPI 已同步到 ${schemaOutputPath}`);
  console.log(`类型声明已生成到 ${typesOutputPath}`);
}

async function readLocalSecret() {
  try {
    const raw = await readFile(join(rootDir, "secret.json"), "utf8");
    return JSON.parse(raw);
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

function deriveOpenapiUrl(swaggerUrl) {
  if (!swaggerUrl) {
    return "";
  }

  const url = new URL(swaggerUrl);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/docs\/?$/, "/openapi.json");
  return url.toString();
}

async function downloadOpenapiSchema(openapiUrl, token) {
  try {
    const response = await fetch(openapiUrl, {
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`拉取 OpenAPI 失败，状态码 ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    return await downloadWithCurl(openapiUrl, token, error);
  }
}

function downloadWithCurl(openapiUrl, token, originalError) {
  return new Promise((resolve, reject) => {
    const args = ["-L", "--silent", "--show-error"];

    if (token) {
      args.push("-H", `Authorization: Bearer ${token}`);
    }

    args.push(openapiUrl);

    const child = spawn("curl", args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          [
            originalError instanceof Error ? originalError.message : "fetch 下载失败",
            stderr.trim(),
          ]
            .filter(Boolean)
            .join("；"),
        ),
      );
    });

    child.on("error", reject);
  });
}

function runOpenapiTypescript(schemaPath, outputPath) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(
      command,
      ["openapi-typescript", schemaPath, "-o", outputPath],
      {
        cwd: rootDir,
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`openapi-typescript 执行失败，退出码 ${code ?? "未知"}`));
    });

    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
