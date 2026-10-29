import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createMaintenanceService } from "../lib/server/maintenance";

const POLL_INTERVAL_MS = 1_000;
const REQUIRED_ENV = [
  "CONSOLE_DATABASE_PATH",
  "KOMARI_API_ORIGIN",
  "KOMARI_API_BEARER_TOKEN",
];

type WorkerConfig = {
  databasePath: string;
  apiOrigin: string;
  bearerToken: string;
};

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
  const config = readWorkerConfig(process.env);
  const maintenance = createMaintenanceService({
    databasePath: config.databasePath,
    upstream: {
      apiOrigin: config.apiOrigin,
      bearerToken: config.bearerToken,
    },
  });

  let stopped = false;
  let activeTick: Promise<void> | null = null;
  let resolveShutdown: (() => void) | null = null;
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const requestShutdown = (signal: NodeJS.Signals) => {
    if (stopped) {
      return;
    }

    stopped = true;
    console.log(`维护通知 Worker 收到 ${signal}，等待当前请求结束后退出。`);
    resolveShutdown?.();
  };

  process.once("SIGINT", () => {
    requestShutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    requestShutdown("SIGTERM");
  });

  const executeTick = async () => {
    try {
      const result = await maintenance.runOnce();

      if (result.processed) {
        console.log(
          `维护通知 Worker 已执行通知 ${result.noticeId} 的尝试 ${result.attemptId}。`,
        );
      }
    } catch (error) {
      console.error(
        "维护通知 Worker 轮询失败：",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const beginTick = () => {
    if (stopped || activeTick) {
      return;
    }

    const current = executeTick();
    activeTick = current;
    current
      .finally(() => {
        if (activeTick === current) {
          activeTick = null;
        }
      })
      .catch(() => {
        // executeTick logs its own failures; keep polling for later work.
      });
  };

  const interval = setInterval(beginTick, POLL_INTERVAL_MS);

  console.log("维护通知 Worker 已启动，轮询间隔 1000ms。");
  beginTick();
  await shutdownRequested;
  clearInterval(interval);

  const waitForActiveTick = () => activeTick ?? Promise.resolve();
  await waitForActiveTick();
}

function readWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const databasePath = env.CONSOLE_DATABASE_PATH?.trim() ?? "";
  const apiOrigin = env.KOMARI_API_ORIGIN?.trim() ?? "";
  const bearerToken = env.KOMARI_API_BEARER_TOKEN?.trim() ?? "";
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`缺少必需的环境变量：${missing.join("、")}。`);
  }

  if (!path.isAbsolute(databasePath) || databasePath.endsWith(path.sep)) {
    throw new Error("CONSOLE_DATABASE_PATH 必须是绝对文件路径。");
  }

  let origin: URL;

  try {
    origin = new URL(apiOrigin);
  } catch {
    throw new Error("KOMARI_API_ORIGIN 格式无效。");
  }

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("KOMARI_API_ORIGIN 必须使用 HTTP 或 HTTPS。");
  }

  if (origin.username || origin.password) {
    throw new Error("KOMARI_API_ORIGIN 不能包含用户信息。");
  }

  return {
    apiOrigin: origin.origin,
    bearerToken,
    databasePath,
  };
}

main().catch((error: unknown) => {
  console.error(
    "维护通知 Worker 启动失败：",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
