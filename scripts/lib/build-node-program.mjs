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

import ts from "typescript";

/**
 * Compile one Node.js entry point with the shared server-tool settings and,
 * unless an explicit --out-dir is given, copy the result into the standalone
 * output. Output directories are cleaned only after their resolved paths pass
 * the safety checks that the maintenance worker build has always enforced.
 */
export function buildNodeProgram({
  args,
  defaultOutputDirectory,
  displayName,
  entry,
  root,
  standaloneTarget,
}) {
  const output = parseOutputArgument(args, defaultOutputDirectory);
  const resolvedOutput = prepareOutputDirectory({
    defaultOutputDirectory,
    explicit: output.explicit,
    outputDirectory: output.outputDirectory,
    root,
  });

  compileNodeProgram({
    displayName,
    entry,
    resolvedOutput,
    root,
  });

  if (!output.explicit) {
    copyIntoStandalone({
      compiledDirectory: resolvedOutput,
      displayName,
      root,
      standaloneTarget,
    });
  }
}

function compileNodeProgram({ displayName, entry, resolvedOutput, root }) {
  const sourceRoot = path.join(root, "src");
  const program = ts.createProgram([entry], {
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmitOnError: true,
    outDir: resolvedOutput,
    rootDir: sourceRoot,
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
    throw new Error("TypeScript 编译失败。");
  }

  const relativeEntry = path.relative(sourceRoot, entry);
  const compiledEntry = path.join(
    resolvedOutput,
    relativeEntry.replace(/\.tsx?$/, ".js"),
  );

  if (!existsSync(compiledEntry)) {
    console.error(`${displayName} 编译产物缺失：${compiledEntry}`);
    throw new Error("编译产物缺失。");
  }

  console.log(`${displayName} 已编译到 ${resolvedOutput}`);
}

function parseOutputArgument(args, defaultOutputDirectory) {
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
    outputDirectory: path.resolve(defaultOutputDirectory),
  };
}

function prepareOutputDirectory({
  defaultOutputDirectory,
  explicit,
  outputDirectory,
  root,
}) {
  const resolvedOutput = path.resolve(outputDirectory);
  const canonicalOutput = canonicalizeNearExistingAncestor(resolvedOutput);

  if (!explicit) {
    const expected = path.resolve(defaultOutputDirectory);
    assertNoSymlinkComponents(resolvedOutput, root);

    if (canonicalOutput !== expected) {
      throw new Error(`拒绝清理不安全的默认输出目录：${resolvedOutput}`);
    }

    removeGeneratedDirectory(canonicalOutput);
    mkdirSync(canonicalOutput, { recursive: true });
    return canonicalOutput;
  }

  assertCustomOutputDirectory(resolvedOutput, canonicalOutput, root);
  mkdirSync(canonicalOutput, { recursive: true });
  return canonicalOutput;
}

function assertCustomOutputDirectory(resolvedOutput, canonicalOutput, root) {
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

function copyIntoStandalone({
  compiledDirectory,
  displayName,
  root,
  standaloneTarget,
}) {
  const standaloneRoot = path.join(root, ".next", "standalone");

  if (!existsSync(standaloneRoot)) {
    console.log("未找到 .next/standalone，跳过独立产物复制。");
    return;
  }

  const target = path.join(standaloneRoot, standaloneTarget);
  assertNoSymlinkComponents(target, root);

  if (existsSync(target)) {
    if (!lstatSync(target).isDirectory()) {
      throw new Error(`独立产物目标不是目录，拒绝删除：${target}`);
    }

    rmSync(target, { force: true, recursive: true });
  }

  cpSync(compiledDirectory, target, { recursive: true });
  console.log(`${displayName} 已复制到 ${target}`);
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
