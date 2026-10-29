import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const entry = path.join(root, "src", "worker", "maintenance-worker.ts");
const output = parseOutputArgument(process.argv.slice(2));

try {
  buildWorker(output);
} catch (error) {
  console.error(
    `维护通知 Worker 构建失败：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}

function buildWorker({ explicit, outputDirectory }) {
  const resolvedOutput = prepareOutputDirectory(
    outputDirectory,
    explicit,
  );

  const program = ts.createProgram([entry], {
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmitOnError: true,
    outDir: resolvedOutput,
    rootDir: path.join(root, "src"),
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ["node"],
  });
  const emit = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emit.diagnostics);

  if (diagnostics.length > 0) {
    reportDiagnostics(diagnostics);
    process.exitCode = 1;
    return;
  }

  const compiledEntry = path.join(
    resolvedOutput,
    "worker",
    "maintenance-worker.js",
  );

  if (!existsSync(compiledEntry)) {
    console.error(`维护通知 Worker 编译产物缺失：${compiledEntry}`);
    process.exitCode = 1;
    return;
  }

  console.log(`维护通知 Worker 已编译到 ${resolvedOutput}`);

  if (!explicit) {
    copyIntoStandalone(resolvedOutput);
  }
}

function parseOutputArgument(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out-dir") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("--out-dir 需要提供目录参数。");
      }

      return { explicit: true, outputDirectory: path.resolve(value) };
    }
  }

  return {
    explicit: false,
    outputDirectory: path.join(root, "dist", "maintenance-worker"),
  };
}

function prepareOutputDirectory(outputDirectory, explicit) {
  const resolvedOutput = path.resolve(outputDirectory);
  const canonicalOutput = canonicalizeNearExistingAncestor(resolvedOutput);

  if (!explicit) {
    const expected = path.join(root, "dist", "maintenance-worker");
    assertNoSymlinkComponents(resolvedOutput, root);

    if (canonicalOutput !== expected) {
      throw new Error(`拒绝清理不安全的默认输出目录：${resolvedOutput}`);
    }

    removeGeneratedDirectory(canonicalOutput);
    mkdirSync(canonicalOutput, { recursive: true });
    return canonicalOutput;
  }

  assertCustomOutputDirectory(resolvedOutput, canonicalOutput);
  mkdirSync(canonicalOutput, { recursive: true });
  return canonicalOutput;
}

function assertCustomOutputDirectory(resolvedOutput, canonicalOutput) {
  const repoRoot = root;
  const repoScratch = path.join(repoRoot, "tmp");
  const tempRootLexical = path.resolve(process.env.TMPDIR ?? "/tmp");
  const tempRoot = canonicalizeNearExistingAncestor(tempRootLexical);
  const filesystemRoot = path.parse(canonicalOutput).root;

  if (
    existsSync(resolvedOutput) &&
    lstatSync(resolvedOutput).isSymbolicLink()
  ) {
    throw new Error(`拒绝使用符号链接作为自定义输出目录：${resolvedOutput}`);
  }

  if (canonicalOutput === repoRoot) {
    throw new Error(`拒绝使用仓库根目录作为自定义输出目录：${resolvedOutput}`);
  }

  if (canonicalOutput === filesystemRoot) {
    throw new Error(`拒绝使用文件系统根目录作为自定义输出目录：${resolvedOutput}`);
  }

  if (isStrictlyInside(canonicalOutput, repoRoot)) {
    if (!isStrictlyInside(canonicalOutput, repoScratch)) {
      throw new Error(
        `拒绝在仓库源码或配置目录内清理/构建：${resolvedOutput}`,
      );
    }

    assertNoSymlinkComponents(resolvedOutput, repoRoot);
  } else {
    if (
      canonicalOutput === tempRoot ||
      !isStrictlyInside(canonicalOutput, tempRoot)
    ) {
      throw new Error(`拒绝使用临时根目录或不安全路径：${resolvedOutput}`);
    }

    assertNoSymlinkComponents(resolvedOutput, tempRootLexical);
  }

  if (
    existsSync(canonicalOutput) &&
    !lstatSync(canonicalOutput).isDirectory()
  ) {
    throw new Error(`自定义输出路径必须是目录：${resolvedOutput}`);
  }

  if (
    existsSync(canonicalOutput) &&
    readdirSync(canonicalOutput).length > 0
  ) {
    throw new Error(
      `拒绝覆盖非空自定义输出目录：${resolvedOutput}；请使用新的空目录`,
    );
  }
}

function removeGeneratedDirectory(directory) {
  if (!existsSync(directory)) {
    return;
  }

  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`默认输出目标不是目录，拒绝删除：${directory}`);
  }

  rmSync(directory, { force: true, recursive: true });
}

function assertNoSymlinkComponents(candidate, boundary) {
  const relative = path.relative(boundary, candidate);

  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`输出目录不在允许的边界内：${candidate}`);
  }

  let current = boundary;

  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);

    if (!existsSync(current)) {
      continue;
    }

    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`拒绝经过符号链接的输出路径：${current}`);
    }
  }
}

function canonicalizeNearExistingAncestor(candidate) {
  let current = candidate;
  const suffix = [];

  while (!existsSync(current)) {
    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    suffix.unshift(path.basename(current));
    current = parent;
  }

  const base = existsSync(current) ? realpathSync(current) : current;

  return path.join(base, ...suffix);
}

function isStrictlyInside(candidate, parent) {
  const relative = path.relative(parent, candidate);

  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function copyIntoStandalone(compiledDirectory) {
  const standaloneRoot = path.join(root, ".next", "standalone");

  if (!existsSync(standaloneRoot)) {
    console.log("未找到 .next/standalone，跳过独立产物复制。");
    return;
  }

  const target = path.join(standaloneRoot, "maintenance-worker");
  assertNoSymlinkComponents(target, root);

  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory()) {
      throw new Error(`独立产物目标不是目录，拒绝删除：${target}`);
    }

    rmSync(target, { force: true, recursive: true });
  }

  cpSync(compiledDirectory, target, { recursive: true });
  console.log(`维护通知 Worker 已复制到 ${target}`);
}

function reportDiagnostics(diagnostics) {
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );

    if (diagnostic.file && diagnostic.start !== undefined) {
      const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
      );
      console.error(
        `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`,
      );
    } else {
      console.error(message);
    }
  }
}
