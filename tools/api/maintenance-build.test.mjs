import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const realScript = path.join(root, "scripts", "build-maintenance-worker.mjs");
const realHelper = path.join(
  root,
  "scripts",
  "lib",
  "build-node-program.mjs",
);
const realNodeModules = path.join(root, "node_modules");
const scratchRoot = path.join(root, "tmp");
const SENTINEL = "synthetic sentinel must survive";

let fixtureRoot;
let scriptPath;

before(() => {
  mkdirSync(scratchRoot, { recursive: true });
  fixtureRoot = mkdtempSync(path.join(scratchRoot, "build-safety-"));
  mkdirSync(path.join(fixtureRoot, "scripts", "lib"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "src", "worker"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "tmp"), { recursive: true });
  scriptPath = path.join(fixtureRoot, "scripts", "build-maintenance-worker.mjs");
  copyFileSync(realScript, scriptPath);
  copyFileSync(
    realHelper,
    path.join(fixtureRoot, "scripts", "lib", "build-node-program.mjs"),
  );
  symlinkSync(realNodeModules, path.join(fixtureRoot, "node_modules"), "dir");
  writeFileSync(
    path.join(fixtureRoot, "src", "worker", "maintenance-worker.ts"),
    "export const syntheticWorkerEntry = 1;\n",
  );
  writeFileSync(path.join(fixtureRoot, "src", "sentinel.txt"), SENTINEL);
});

after(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

describe("maintenance worker build output safety", () => {
  it("rejects the repository source directory before deleting anything", async () => {
    const result = await runScript(["--out-dir", path.join(fixtureRoot, "src")]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|不安全/);
    assert.equal(
      readFileSync(path.join(fixtureRoot, "src", "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("rejects a nonempty custom output directory without deleting it", async () => {
    const output = path.join(fixtureRoot, "tmp", "nonempty-output");
    mkdirSync(output);
    writeFileSync(path.join(output, "sentinel.txt"), SENTINEL);

    const result = await runScript(["--out-dir", output]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|非空/);
    assert.equal(
      readFileSync(path.join(output, "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("builds into a new dedicated scratch directory", async () => {
    const output = path.join(fixtureRoot, "tmp", "valid-output");
    const result = await runScript(["--out-dir", output]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      existsSync(path.join(output, "worker", "maintenance-worker.js")),
      true,
    );
    assert.equal(
      readFileSync(path.join(fixtureRoot, "src", "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("rebuilds the default generated target twice without deleting siblings", async () => {
    const sibling = path.join(fixtureRoot, "dist", "unrelated");
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, "sentinel.txt"), SENTINEL);

    const first = await runScript([]);
    const second = await runScript([]);

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(
      existsSync(
        path.join(
          fixtureRoot,
          "dist",
          "maintenance-worker",
          "worker",
          "maintenance-worker.js",
        ),
      ),
      true,
    );
    assert.equal(
      readFileSync(path.join(sibling, "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("rejects a custom output behind a symlink ancestor", async () => {
    const outside = path.join(fixtureRoot, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(fixtureRoot, "tmp", "linked"), "dir");
    const output = path.join(fixtureRoot, "tmp", "linked", "build");

    const result = await runScript(["--out-dir", output]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|符号链接/);
    assert.equal(existsSync(path.join(outside, "build")), false);
  });

  it("rejects the scratch root itself as a custom output", async () => {
    const result = await runScript([
      "--out-dir",
      path.join(fixtureRoot, "tmp"),
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|不安全/);
  });
});

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: fixtureRoot,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}
