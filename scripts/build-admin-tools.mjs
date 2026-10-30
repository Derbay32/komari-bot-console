import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeProgram } from "./lib/build-node-program.mjs";

const DISPLAY_NAME = "管理员密码重置工具";
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

try {
  buildNodeProgram({
    args: process.argv.slice(2),
    defaultOutputDirectory: path.join(root, "dist", "admin-tools"),
    displayName: DISPLAY_NAME,
    entry: path.join(root, "src", "cli", "reset-password.ts"),
    root,
    standaloneTarget: path.join("dist", "admin-tools"),
  });
} catch (error) {
  console.error(
    `${DISPLAY_NAME} 构建失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
