import { initializeConsoleAdmin } from "./admin-account";
import { getConsoleAuthEnvironment } from "./auth-config";

export const CONSOLE_BOOTSTRAP_FAILED_MESSAGE =
  "控制台管理员凭据初始化失败。";

/**
 * Prepare the console administrator credential during Node.js server startup.
 * The plaintext password is printed only by the instance that committed a new
 * random initial credential. Normal restarts emit nothing.
 */
export async function bootstrapConsoleAuthentication(): Promise<void> {
  let databasePath: string;

  try {
    databasePath = getConsoleAuthEnvironment().databasePath;
  } catch {
    failBootstrap();
  }

  let result: Awaited<ReturnType<typeof initializeConsoleAdmin>>;

  try {
    result = await initializeConsoleAdmin(databasePath);
  } catch {
    failBootstrap();
  }

  if (!result.initialized) {
    return;
  }

  console.log(
    [
      "控制台管理员随机初始密码已生成，仅显示这一次。",
      `用户名：${result.username}`,
      `初始密码：${result.password}`,
      "请立即保存该密码。如果未保存，重启不会再次显示；",
      "请使用服务端重置命令恢复登录。",
    ].join("\n"),
  );
}

function failBootstrap(): never {
  console.error(CONSOLE_BOOTSTRAP_FAILED_MESSAGE);
  throw new Error(CONSOLE_BOOTSTRAP_FAILED_MESSAGE);
}
