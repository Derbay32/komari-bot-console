import { loadEnvConfig } from "@next/env";

import {
  ConsoleAdminAccountError,
  resetConsoleAdminPassword,
} from "../lib/server/admin-account";
import {
  ConsoleConfigError,
  getConsoleDatabasePath,
} from "../lib/server/auth-config";

const COMMAND = "npm run reset:password";
const ARGUMENT_ERROR_MESSAGE = `密码重置命令不接受任何参数，请直接运行 ${COMMAND}。`;
const CONFIG_ERROR_MESSAGE =
  "无法读取控制台数据库配置，请把绝对文件路径设置到环境变量 CONSOLE_DATABASE_PATH。";
const ACCOUNT_ERROR_MESSAGE =
  "控制台管理员账户不可用，未修改原凭据和登录会话。";
const UNEXPECTED_ERROR_MESSAGE = "控制台管理员密码重置失败。";

async function main() {
  if (process.argv.length > 2) {
    console.error(ARGUMENT_ERROR_MESSAGE);
    process.exitCode = 1;
    return;
  }

  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");

  let result: Awaited<ReturnType<typeof resetConsoleAdminPassword>>;

  try {
    result = await resetConsoleAdminPassword(getConsoleDatabasePath());
  } catch (error) {
    console.error(resetFailureMessage(error));
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      "控制台管理员密码已重置。",
      "新密码仅显示这一次。",
      `用户名：${result.username}`,
      `新密码：${result.password}`,
      "请立即保存新密码。",
      "在修改密码或再次重置前，该密码可以重复使用。",
      `如果未保存新密码，请重新运行 ${COMMAND}。`,
    ].join("\n"),
  );
}

function resetFailureMessage(error: unknown) {
  if (error instanceof ConsoleConfigError) {
    return CONFIG_ERROR_MESSAGE;
  }

  if (error instanceof ConsoleAdminAccountError) {
    return ACCOUNT_ERROR_MESSAGE;
  }

  return UNEXPECTED_ERROR_MESSAGE;
}

main().catch(() => {
  console.error(UNEXPECTED_ERROR_MESSAGE);
  process.exitCode = 1;
});
