import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
const fixtureUrl = new URL("./maintenance-fixtures.mjs", import.meta.url).href;
const modules = await loadMaintenanceModules();

const CHILD_SOURCE = [
  `import { loadMaintenanceModules } from ${JSON.stringify(fixtureUrl)};`,
  "const modules = await loadMaintenanceModules();",
  "const maintenance = modules.service.createMaintenanceService({",
  "  databasePath: process.env.CHILD_DB,",
  "  now: () => Number(process.env.CHILD_NOW),",
  "  upstream: {",
  '    apiOrigin: process.env.CHILD_UPSTREAM,',
  '    bearerToken: "concurrency-synthetic-token",',
  "  },",
  "});",
  "const send = (payload) => new Promise((resolve, reject) => {",
  "  if (!process.connected) {",
  '    reject(new Error("IPC channel closed before result"));',
  "    return;",
  "  }",
  "  process.send(payload, (error) => {",
  "    if (error) reject(error);",
  "    else resolve();",
  "  });",
  "});",
  "const finish = async (payload) => {",
  "  try {",
  "    await send(payload);",
  "  } finally {",
  "    if (process.connected) process.disconnect();",
  "  }",
  "};",
  "process.on(\"message\", async (message) => {",
  "  if (!message || message.type !== \"go\") return;",
  "  try {",
  "    let value;",
  "    if (process.env.CHILD_OP === \"runOnce\") {",
  "      value = await maintenance.runOnce();",
  "    } else if (process.env.CHILD_OP === \"cancel\") {",
  "      value = await maintenance.cancel(process.env.CHILD_ID, {",
  "        version: Number(process.env.CHILD_VERSION),",
  "      });",
  "    } else if (process.env.CHILD_OP === \"update\") {",
  "      value = await maintenance.update(",
  "        process.env.CHILD_ID,",
  "        JSON.parse(process.env.CHILD_UPDATE),",
  "      );",
  "    } else {",
  '      throw new Error("unknown child operation");',
  "    }",
  '    await finish({ type: "result", status: "fulfilled", value });',
  "  } catch (error) {",
  "    await finish({",
  '      type: "result",',
  '      status: "rejected",',
  "      error: {",
  '        name: (error && error.name) || "Error",',
  "        message: (error && error.message) || String(error),",
  "        currentNotice: (error && error.currentNotice) || null,",
  "      },",
  "    });",
  "  }",
  "});",
  "await send({ type: \"ready\" });",
].join("\n");

describe("maintenance cross-process edit and claim races", () => {
  it(
    "serializes cancel against runOnce across two OS processes",
    { timeout: 60_000 },
    async () => {
      const temp = await createTempDatabase("maintenance-concurrency-cancel-");
      const upstream = await startFakeUpstream((request) => ({
        body: successfulResponse(readJsonBody(request).group_ids),
      }));
      const now = 1_800_000_000_000;
      const parentService = createService(temp.databasePath, () => now, upstream);
      const children = [];
      let exitStates = [];

      try {
        const created = await parentService.create(
          maintenanceInput({ groupIds: [101, 202] }),
          "cross-process-cancel-vs-run",
        );
        const id = created.notice.id;

        children.push(
          startChild({
            databasePath: temp.databasePath,
            now,
            operation: "cancel",
            noticeId: id,
            upstreamOrigin: upstream.origin,
            version: 1,
          }),
          startChild({
            databasePath: temp.databasePath,
            now,
            operation: "runOnce",
            noticeId: id,
            upstreamOrigin: upstream.origin,
          }),
        );
        assert.notEqual(children[0].child.pid, process.pid);
        assert.notEqual(children[0].child.pid, children[1].child.pid);

        await waitForChildrenReady(children);
        await releaseChildren(children);

        const [cancelResult, runResult] = await withTimeout(
          Promise.all(children.map((child) => child.result.promise)),
          20_000,
          "cancel/runOnce child results",
        );
        exitStates = await waitForChildrenExit(children);

        assert.equal(exitStates[0].code, 0, children[0].stderr);
        assert.equal(exitStates[1].code, 0, children[1].stderr);
        assert.equal(runResult.status, "fulfilled");

        const detail = await parentService.get(id);
        assert.ok(detail);
        assert.equal(detail.attemptCount, 1);

        if (cancelResult.status === "fulfilled") {
          assert.ok(cancelResult.value);
          assert.equal(cancelResult.value.status, "canceled");
          assert.equal(runResult.value.processed, false);
          assert.equal(upstream.requests.length, 0);
          assert.equal(detail.status, "canceled");
          assert.equal(detail.activity, null);
          assert.equal(detail.attempts[0].phase, "completed");
          assert.equal(detail.attempts[0].executed, false);
          assert.deepEqual(detail.attempts[0].results, []);
        } else {
          assert.equal(cancelResult.status, "rejected");
          assert.equal(cancelResult.error.name, "MaintenanceConflictError");
          assert.equal(cancelResult.error.currentNotice?.status, "sent");
          assert.equal(upstream.requests.length, 1);
          assert.equal(detail.status, "sent");
          assert.deepEqual(readJsonBody(upstream.requests[0]), {
            content: "预计维护 10 分钟\n期间可能出现短暂不可用",
            group_ids: [101, 202],
            scheduled_time: "2026-11-01 22:00 - 23:00",
            title: "Komari 服务维护通知",
          });
        }

        assert.equal(detail.status === "canceled" ? 0 : 1, upstream.requests.length);
      } finally {
        await stopChildren(children);
        await upstream.close();
        await temp.cleanup();
      }
    },
  );

  it(
    "serializes an update against a due scheduled claim across two OS processes",
    { timeout: 60_000 },
    async () => {
      const temp = await createTempDatabase("maintenance-concurrency-update-");
      const upstream = await startFakeUpstream((request) => ({
        body: successfulResponse(readJsonBody(request).group_ids),
      }));
      const dueNow = 1_800_000_000_000;
      let parentNow = dueNow - 1_000;
      const parentService = createService(
        temp.databasePath,
        () => parentNow,
        upstream,
      );
      const children = [];
      let exitStates = [];
      const editedPlan = dueNow + 10 * 60_000;
      const updateInput = {
        ...maintenanceInput({
          content: "并发修改正文",
          groupIds: [303, 404],
          maintenanceTime: "2026-12-01 10:00 - 11:00",
          mode: "scheduled",
          plannedAt: editedPlan,
          title: "并发修改标题",
        }),
        version: 1,
      };

      try {
        const created = await parentService.create(
          maintenanceInput({
            content: "原始正文",
            groupIds: [11, 22],
            mode: "scheduled",
            plannedAt: dueNow,
            title: "原始标题",
          }),
          "cross-process-update-vs-claim",
        );
        const id = created.notice.id;

        children.push(
          startChild({
            databasePath: temp.databasePath,
            now: dueNow,
            operation: "update",
            noticeId: id,
            upstreamOrigin: upstream.origin,
            update: updateInput,
            version: 1,
          }),
          startChild({
            databasePath: temp.databasePath,
            now: dueNow,
            operation: "runOnce",
            noticeId: id,
            upstreamOrigin: upstream.origin,
          }),
        );
        assert.notEqual(children[0].child.pid, process.pid);
        assert.notEqual(children[0].child.pid, children[1].child.pid);

        await waitForChildrenReady(children);
        await releaseChildren(children);

        const [updateResult, runResult] = await withTimeout(
          Promise.all(children.map((child) => child.result.promise)),
          20_000,
          "update/claim child results",
        );
        exitStates = await waitForChildrenExit(children);

        assert.equal(exitStates[0].code, 0, children[0].stderr);
        assert.equal(exitStates[1].code, 0, children[1].stderr);
        assert.equal(runResult.status, "fulfilled");

        if (updateResult.status === "fulfilled") {
          assert.equal(updateResult.value.status, "upcoming");
          assert.equal(updateResult.value.version, 2);
          assert.equal(runResult.value.processed, false);
          assert.equal(upstream.requests.length, 0);

          let detail = await parentService.get(id);
          assert.ok(detail);
          assert.equal(detail.status, "upcoming");
          assert.equal(detail.title, "并发修改标题");
          assert.equal(detail.plannedAt, editedPlan);
          assert.deepEqual(detail.groupIds, [303, 404]);
          assert.deepEqual(detail.attempts[0].requestBody, {
            content: "并发修改正文",
            group_ids: [303, 404],
            scheduled_time: "2026-12-01 10:00 - 11:00",
            title: "并发修改标题",
          });

          parentNow = editedPlan;
          const laterRun = await parentService.runOnce();
          assert.equal(laterRun.processed, true);
          assert.equal(upstream.requests.length, 1);
          assert.deepEqual(readJsonBody(upstream.requests[0]), {
            content: "并发修改正文",
            group_ids: [303, 404],
            scheduled_time: "2026-12-01 10:00 - 11:00",
            title: "并发修改标题",
          });
          assert.equal(
            upstream.requests.some(
              (request) => readJsonBody(request).title === "原始标题",
            ),
            false,
          );

          detail = await parentService.get(id);
          assert.equal(detail?.status, "sent");
          assert.equal(detail?.attemptCount, 1);
          assert.equal(detail?.attempts[0].executed, true);
          assert.deepEqual(detail?.attempts[0].targetGroupIds, [303, 404]);
        } else {
          assert.equal(updateResult.status, "rejected");
          assert.equal(updateResult.error.name, "MaintenanceConflictError");
          assert.equal(updateResult.error.currentNotice?.status, "sent");
          assert.equal(runResult.value.processed, true);
          assert.equal(upstream.requests.length, 1);
          assert.deepEqual(readJsonBody(upstream.requests[0]), {
            content: "原始正文",
            group_ids: [11, 22],
            scheduled_time: "2026-11-01 22:00 - 23:00",
            title: "原始标题",
          });

          const detail = await parentService.get(id);
          assert.ok(detail);
          assert.equal(detail.status, "sent");
          assert.equal(detail.title, "原始标题");
          assert.equal(detail.content, "原始正文");
          assert.equal(detail.plannedAt, dueNow);
          assert.deepEqual(detail.groupIds, [11, 22]);
          assert.deepEqual(detail.attempts[0].requestBody, {
            content: "原始正文",
            group_ids: [11, 22],
            scheduled_time: "2026-11-01 22:00 - 23:00",
            title: "原始标题",
          });
        }
      } finally {
        await stopChildren(children);
        await upstream.close();
        await temp.cleanup();
      }
    },
  );
});

function createService(databasePath, nowProvider, upstream) {
  return modules.service.createMaintenanceService({
    databasePath,
    now: nowProvider,
    upstream: {
      apiOrigin: upstream.origin,
      bearerToken: TEST_BACKEND_TOKEN,
    },
  });
}

function startChild(options) {
  const env = {
    ...process.env,
    CHILD_DB: options.databasePath,
    CHILD_ID: options.noticeId ?? "",
    CHILD_NOW: String(options.now),
    CHILD_OP: options.operation,
    CHILD_UPDATE: options.update ? JSON.stringify(options.update) : "",
    CHILD_UPSTREAM: options.upstreamOrigin,
    CHILD_VERSION:
      options.version === undefined ? "" : String(options.version),
  };
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", CHILD_SOURCE],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const state = {
    child,
    exit: deferred(),
    exited: false,
    ready: deferred(),
    readySettled: false,
    result: deferred(),
    resultSettled: false,
    stderr: "",
    stdout: "",
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    state.stderr += chunk;
  });
  child.on("message", (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "ready" && !state.readySettled) {
      state.readySettled = true;
      state.ready.resolve();
      return;
    }

    if (message.type === "result" && !state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve(message);
    }
  });
  child.on("error", (error) => {
    if (!state.readySettled) {
      state.readySettled = true;
      state.ready.reject(error);
    }

    if (!state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve({
        error: {
          currentNotice: null,
          message: error.message,
          name: error.name,
        },
        status: "rejected",
        type: "result",
      });
    }
  });
  child.on("exit", (code, signal) => {
    state.exited = true;
    state.exit.resolve({ code, signal });

    if (!state.readySettled) {
      state.readySettled = true;
      state.ready.reject(
        new Error(
          `子进程在就绪前退出（code=${code}, signal=${signal}）：${state.stderr}`,
        ),
      );
    }

    if (!state.resultSettled) {
      state.resultSettled = true;
      state.result.resolve({
        error: {
          currentNotice: null,
          message: `子进程未返回结果即退出（code=${code}, signal=${signal}）：${state.stderr}`,
          name: "ChildExitError",
        },
        status: "rejected",
        type: "result",
      });
    }
  });

  return state;
}

async function waitForChildrenReady(children) {
  await withTimeout(
    Promise.all(children.map((child) => child.ready.promise)),
    20_000,
    "child ready barrier",
  );
}

async function releaseChildren(children) {
  const releases = children.map(
    (child) =>
      new Promise((resolve, reject) => {
        child.child.send({ type: "go" }, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  );

  await Promise.all(releases);
}

async function waitForChildrenExit(children) {
  return withTimeout(
    Promise.all(children.map((child) => child.exit.promise)),
    10_000,
    "child exit",
  );
}

async function stopChildren(children) {
  for (const child of children) {
    if (!child.exited) {
      try {
        child.child.kill("SIGKILL");
      } catch {
        // The child may already be gone; cleanup continues.
      }
    }
  }

  await Promise.all(
    children.map((child) =>
      Promise.race([
        child.exit.promise,
        new Promise((resolve) => {
          setTimeout(resolve, 1_000);
        }),
      ]),
    ),
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${timeoutMs}ms）。`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
