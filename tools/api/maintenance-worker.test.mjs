import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTempDatabase,
  loadMaintenanceModules,
  maintenanceInput,
  readJsonBody,
  startFakeUpstream,
  successfulResponse,
  TEST_BACKEND_TOKEN,
} from "./maintenance-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const buildScript = path.join(root, "scripts/build-maintenance-worker.mjs");
const buildRoot = path.join(root, "tmp");
const modules = await loadMaintenanceModules();
let workerEntry;
let buildDirectory;
let upstream;
let temp;

before(async () => {
  await mkdir(buildRoot, { recursive: true });
  buildDirectory = await mkdtemp(path.join(buildRoot, "worker-build-"));
  const outputDirectory = path.join(buildDirectory, "dist");
  const build = await runProcess(process.execPath, [
    buildScript,
    "--out-dir",
    outputDirectory,
  ]);

  assert.equal(build.code, 0, build.stderr);
  workerEntry = path.join(
    outputDirectory,
    "worker",
    "maintenance-worker.js",
  );
  assert.equal(existsSync(workerEntry), true);
});

after(async () => {
  await rm(buildDirectory, { force: true, recursive: true });
});

describe("maintenance worker CLI", () => {
  it("executes a persisted attempt from a synthetic cwd and environment", async () => {
    temp = await createTempDatabase("worker-run-");
    upstream = await startFakeUpstream((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));
    const maintenance = createWorkerTestService(temp.databasePath);
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [701, 702] }),
      "worker-run-key",
    );
    const child = startWorker({
      databasePath: temp.databasePath,
      origin: upstream.origin,
    });

    try {
      await waitFor(async () => {
        const detail = await maintenance.get(created.notice.id);
        return detail?.attempts[0]?.phase === "completed";
      }, 10_000);
      const detail = await maintenance.get(created.notice.id);

      assert.equal(detail?.status, "sent");
      assert.equal(detail?.aggregate.allSuccess, true);
      assert.equal(upstream.requests.length, 1);
      assert.equal(
        upstream.requests[0].url,
        "/api/v2/komari-announce/maintenance",
      );
      assert.deepEqual(readJsonBody(upstream.requests[0]).group_ids, [
        701, 702,
      ]);
      assert.equal(
        upstream.requests[0].headers.authorization,
        `Bearer ${TEST_BACKEND_TOKEN}`,
      );
      assert.match(
        upstream.requests[0].headers["x-request-id"],
        /^maint-[0-9a-f-]{36}$/,
      );

      const exit = await terminateWorker(child);
      assert.equal(exit.code, 0, exit.stderr);
    } finally {
      await forceStop(child);
      await upstream.close();
      upstream = null;
      await temp.cleanup();
      temp = null;
    }
  });

  it("allows only one of two independent worker processes to send an attempt", async () => {
    temp = await createTempDatabase("worker-concurrent-");
    upstream = await startFakeUpstream(async (request) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });
    const maintenance = createWorkerTestService(temp.databasePath);
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [801] }),
      "worker-concurrent-key",
    );
    const first = startWorker({
      databasePath: temp.databasePath,
      origin: upstream.origin,
    });
    const second = startWorker({
      databasePath: temp.databasePath,
      origin: upstream.origin,
    });

    try {
      await waitFor(async () => {
        const detail = await maintenance.get(created.notice.id);
        return detail?.attempts[0]?.phase === "completed";
      }, 10_000);
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      assert.equal(upstream.requests.length, 1);
      const detail = await maintenance.get(created.notice.id);
      assert.equal(detail?.attempts.length, 1);
      assert.equal(detail?.attempts[0].executed, true);

      const exits = await Promise.all([
        terminateWorker(first),
        terminateWorker(second),
      ]);
      assert.deepEqual(
        exits.map((exit) => exit.code),
        [0, 0],
      );
    } finally {
      await forceStop(first);
      await forceStop(second);
      await upstream.close();
      upstream = null;
      await temp.cleanup();
      temp = null;
    }
  });

  it("waits for the owned request before exiting on SIGTERM", async () => {
    temp = await createTempDatabase("worker-shutdown-");
    let releaseRequest;
    const gate = new Promise((resolve) => {
      releaseRequest = resolve;
    });
    upstream = await startFakeUpstream(async (request) => {
      await gate;

      return { body: successfulResponse(readJsonBody(request).group_ids) };
    });
    const maintenance = createWorkerTestService(temp.databasePath);
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [901] }),
      "worker-shutdown-key",
    );
    const child = startWorker({
      databasePath: temp.databasePath,
      origin: upstream.origin,
    });

    try {
      await waitFor(() => upstream.requests.length === 1, 10_000);
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(child.exitCode, null);

      releaseRequest();
      const exit = await waitForExit(child, 5_000);
      assert.equal(exit.code, 0);
      assert.match(exit.stdout, /收到 SIGTERM/);

      const detail = await maintenance.get(created.notice.id);
      assert.equal(detail?.attempts[0].phase, "completed");
      assert.equal(detail?.attempts[0].executed, true);
      assert.equal(detail?.aggregate.allSuccess, true);
    } finally {
      await forceStop(child);
      await upstream.close();
      upstream = null;
      await temp.cleanup();
      temp = null;
    }
  });

  it("loads escaped .env values with the same expansion as Next", async () => {
    temp = await createTempDatabase("worker-env-escaped-");
    upstream = await startFakeUpstream((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));
    const maintenance = createWorkerTestService(temp.databasePath);
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [910] }),
      "worker-env-escaped-key",
    );
    writeEnvFile(temp.directory, [
      `CONSOLE_DATABASE_PATH=${temp.databasePath}`,
      `KOMARI_API_ORIGIN=${upstream.origin}`,
      "KOMARI_API_BEARER_TOKEN=synthetic\\$token",
    ]);
    const child = startWorker({
      cwd: temp.directory,
      databasePath: null,
      origin: null,
    });

    try {
      await waitFor(async () => {
        const detail = await maintenance.get(created.notice.id);
        return detail?.attempts[0]?.phase === "completed";
      }, 10_000);

      assert.equal(upstream.requests.length, 1);
      assert.equal(
        upstream.requests[0].headers.authorization,
        "Bearer synthetic$token",
      );
      const exit = await terminateWorker(child);
      assert.equal(exit.code, 0, exit.stderr);
    } finally {
      await forceStop(child);
      await upstream.close();
      upstream = null;
      await temp.cleanup();
      temp = null;
    }
  });

  it("lets process environment values override the worker .env file", async () => {
    temp = await createTempDatabase("worker-env-precedence-");
    upstream = await startFakeUpstream((request) => ({
      body: successfulResponse(readJsonBody(request).group_ids),
    }));
    const maintenance = createWorkerTestService(temp.databasePath);
    const created = await maintenance.create(
      maintenanceInput({ groupIds: [911] }),
      "worker-env-precedence-key",
    );
    writeEnvFile(temp.directory, [
      `CONSOLE_DATABASE_PATH=${temp.databasePath}`,
      `KOMARI_API_ORIGIN=${upstream.origin}`,
      "KOMARI_API_BEARER_TOKEN=file\\$token",
    ]);
    const child = startWorker({
      cwd: temp.directory,
      databasePath: null,
      env: { KOMARI_API_BEARER_TOKEN: "env-precedence-token" },
      origin: null,
    });

    try {
      await waitFor(async () => {
        const detail = await maintenance.get(created.notice.id);
        return detail?.attempts[0]?.phase === "completed";
      }, 10_000);

      assert.equal(upstream.requests.length, 1);
      assert.equal(
        upstream.requests[0].headers.authorization,
        "Bearer env-precedence-token",
      );
      const exit = await terminateWorker(child);
      assert.equal(exit.code, 0, exit.stderr);
    } finally {
      await forceStop(child);
      await upstream.close();
      upstream = null;
      await temp.cleanup();
      temp = null;
    }
  });

  it("fails closed with configuration variable names when required env is missing", async () => {
    const child = startWorker({ databasePath: null, origin: null });
    const exit = await waitForExit(child, 5_000);

    assert.equal(exit.code, 1);
    assert.match(exit.stderr + exit.stdout, /CONSOLE_DATABASE_PATH/);
    assert.equal(
      (exit.stderr + exit.stdout).includes(TEST_BACKEND_TOKEN),
      false,
    );
  });
});

function createWorkerTestService(databasePath) {
  return modules.service.createMaintenanceService({
    databasePath,
    upstream: { apiOrigin: "http://127.0.0.1:1", bearerToken: TEST_BACKEND_TOKEN },
  });
}

function startWorker({
  cwd = buildDirectory,
  databasePath,
  env: extraEnv = {},
  origin,
}) {
  const env = {
    HOME: buildDirectory,
    PATH: process.env.PATH,
    TMPDIR: buildDirectory,
    ...extraEnv,
  };

  if (databasePath) {
    env.CONSOLE_DATABASE_PATH = databasePath;
  }

  if (origin) {
    env.KOMARI_API_ORIGIN = origin;
    env.KOMARI_API_BEARER_TOKEN = TEST_BACKEND_TOKEN;
  }

  return spawn(process.execPath, [workerEntry], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeEnvFile(directory, lines) {
  writeFileSync(
    path.join(directory, ".env"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

async function terminateWorker(child) {
  if (child.exitCode !== null) {
    return {
      code: child.exitCode,
      stderr: child.stderrText?.() ?? "",
      stdout: child.stdoutText?.() ?? "",
    };
  }

  const exit = waitForExit(child, 5_000);
  child.kill("SIGTERM");
  return exit;
}

async function forceStop(child) {
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child, 2_000).catch(() => {});
  }
}

function waitForExit(child, timeoutMs) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdoutText = () => stdout;
  child.stderrText = () => stderr;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Worker did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stderr, stdout });
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();

  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("等待条件超时。");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr, stdout }));
  });
}
