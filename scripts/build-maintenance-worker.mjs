import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildNodeProgram } from "./lib/build-node-program.mjs";

const DISPLAY_NAME = "维护通知 Worker";
const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

try {
  buildNodeProgram({
    args: process.argv.slice(2),
    defaultOutputDirectory: path.join(root, "dist", "maintenance-worker"),
    displayName: DISPLAY_NAME,
    entry: path.join(root, "src", "worker", "maintenance-worker.ts"),
    root,
    standaloneTarget: "maintenance-worker",
  });
} catch (error) {
  console.error(
    `${DISPLAY_NAME} 构建失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
