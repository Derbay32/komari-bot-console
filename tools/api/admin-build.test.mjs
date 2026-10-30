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
const scratchRoot = path.join(root, "tmp");
const SENTINEL = "synthetic standalone sentinel must survive";

let fixtureRoot;
let adminScript;
let workerScript;

before(() => {
  mkdirSync(scratchRoot, { recursive: true });
  fixtureRoot = mkdtempSync(path.join(scratchRoot, "admin-build-safety-"));
  mkdirSync(path.join(fixtureRoot, "scripts", "lib"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "src", "cli"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "src", "worker"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "tmp"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, ".next", "standalone"), {
    recursive: true,
  });
  adminScript = path.join(fixtureRoot, "scripts", "build-admin-tools.mjs");
  workerScript = path.join(
    fixtureRoot,
    "scripts",
    "build-maintenance-worker.mjs",
  );
  copyFileSync(
    path.join(root, "scripts", "build-admin-tools.mjs"),
    adminScript,
  );
  copyFileSync(
    path.join(root, "scripts", "build-maintenance-worker.mjs"),
    workerScript,
  );
  copyFileSync(
    path.join(root, "scripts", "lib", "build-node-program.mjs"),
    path.join(fixtureRoot, "scripts", "lib", "build-node-program.mjs"),
  );
  symlinkSync(
    path.join(root, "node_modules"),
    path.join(fixtureRoot, "node_modules"),
    "dir",
  );
  writeFileSync(
    path.join(fixtureRoot, "src", "cli", "reset-password.ts"),
    "export const syntheticAdminEntry = 1;\n",
  );
  writeFileSync(
    path.join(fixtureRoot, "src", "worker", "maintenance-worker.ts"),
    "export const syntheticWorkerEntry = 1;\n",
  );
  writeFileSync(
    path.join(fixtureRoot, ".next", "standalone", "server.js"),
    SENTINEL,
  );
  writeFileSync(path.join(fixtureRoot, "src", "sentinel.txt"), SENTINEL);
});

after(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

describe("admin tools build output safety", () => {
  it("builds the admin tool and copies it into the standalone output", async () => {
    const result = await runScript(adminScript, []);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      existsSync(
        path.join(
          fixtureRoot,
          "dist",
          "admin-tools",
          "cli",
          "reset-password.js",
        ),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(
          fixtureRoot,
          ".next",
          "standalone",
          "dist",
          "admin-tools",
          "cli",
          "reset-password.js",
        ),
      ),
      true,
    );
    assert.equal(
      readFileSync(
        path.join(fixtureRoot, ".next", "standalone", "server.js"),
        "utf8",
      ),
      SENTINEL,
    );
  });

  it("keeps the maintenance worker standalone target unchanged", async () => {
    const result = await runScript(workerScript, []);

    assert.equal(result.code, 0, result.stderr);
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
      existsSync(
        path.join(
          fixtureRoot,
          ".next",
          "standalone",
          "maintenance-worker",
          "worker",
          "maintenance-worker.js",
        ),
      ),
      true,
    );
    assert.equal(
      readFileSync(
        path.join(fixtureRoot, ".next", "standalone", "server.js"),
        "utf8",
      ),
      SENTINEL,
    );
  });

  it("rejects the repository source directory before deleting anything", async () => {
    const result = await runScript(adminScript, [
      "--out-dir",
      path.join(fixtureRoot, "src"),
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|不安全/);
    assert.equal(
      readFileSync(path.join(fixtureRoot, "src", "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("rejects a nonempty custom output directory without deleting it", async () => {
    const output = path.join(fixtureRoot, "tmp", "nonempty-admin-output");
    mkdirSync(output);
    writeFileSync(path.join(output, "sentinel.txt"), SENTINEL);

    const result = await runScript(adminScript, ["--out-dir", output]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|非空/);
    assert.equal(
      readFileSync(path.join(output, "sentinel.txt"), "utf8"),
      SENTINEL,
    );
  });

  it("rejects a custom output behind a symlink ancestor", async () => {
    const outside = path.join(fixtureRoot, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(fixtureRoot, "tmp", "linked"), "dir");
    const output = path.join(fixtureRoot, "tmp", "linked", "admin-build");

    const result = await runScript(adminScript, ["--out-dir", output]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|符号链接/);
    assert.equal(existsSync(path.join(outside, "admin-build")), false);
  });

  it("rejects the scratch root itself as a custom output", async () => {
    const result = await runScript(adminScript, [
      "--out-dir",
      path.join(fixtureRoot, "tmp"),
    ]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr + result.stdout, /拒绝|不安全/);
  });

  it("builds into a new dedicated scratch directory", async () => {
    const output = path.join(fixtureRoot, "tmp", "valid-admin-output");
    rmSync(path.join(fixtureRoot, ".next", "standalone", "dist"), {
      force: true,
      recursive: true,
    });

    const result = await runScript(adminScript, ["--out-dir", output]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      existsSync(path.join(output, "cli", "reset-password.js")),
      true,
    );
    assert.equal(
      existsSync(path.join(fixtureRoot, ".next", "standalone", "dist")),
      false,
    );
  });
});

function runScript(scriptPath, args) {
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
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}
