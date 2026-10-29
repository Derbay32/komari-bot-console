import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTempDatabase,
  loadMaintenanceModules,
  maintenanceInput,
} from "./maintenance-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const writerEntry = fileURLToPath(
  new URL("./maintenance-consistency-writer.mjs", import.meta.url),
);
const modules = await loadMaintenanceModules();
const NOTICE_COUNT = 160;

let temp;

before(async () => {
  temp = await createTempDatabase("maintenance-consistency-");
});

after(async () => {
  await temp.cleanup();
});

describe("consistent public reads during concurrent writes", () => {
  it("keeps every list and get summary on one SQLite snapshot", async () => {
    const seedService = modules.service.createMaintenanceService({
      databasePath: temp.databasePath,
      upstream: {
        apiOrigin: "http://127.0.0.1:1",
        bearerToken: "seed-synthetic-token",
      },
    });

    for (let index = 0; index < NOTICE_COUNT; index += 1) {
      const created = await seedService.create(
        maintenanceInput({
          content: `consistency content ${index}`,
          groupIds: [1000 + index],
          title: `consistency notice ${index}`,
        }),
        `consistency-${String(index).padStart(3, "0")}`,
      );
      assert.equal(created.created, true);
    }

    const donePath = path.join(temp.directory, "writer-done.json");
    const child = spawn(
      process.execPath,
      [writerEntry, temp.databasePath, String(NOTICE_COUNT), donePath],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let childStdout = "";
    let childStderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      childStdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      childStderr += chunk;
    });

    const reader = modules.service.createMaintenanceService({
      databasePath: temp.databasePath,
      upstream: {
        apiOrigin: "http://127.0.0.1:1",
        bearerToken: "reader-synthetic-token",
      },
    });
    const violations = [];
    let observedSent = 0;
    let observedUpcoming = 0;
    let lists = 0;
    let gets = 0;
    const startedAt = Date.now();

    try {
      for (;;) {
        const summaries = await reader.list();
        lists += 1;

        for (const summary of summaries) {
          if (summary.status === "sent") {
            observedSent += 1;
          } else if (summary.status === "upcoming") {
            observedUpcoming += 1;
          }

          collectViolations(
            violations,
            "list",
            summaryViolations(summary),
            summary,
          );
        }

        if (summaries.length > 0) {
          const sampled = summaries[(lists * 7) % summaries.length];
          const detail = await reader.get(sampled.id);
          gets += 1;

          if (detail) {
            collectViolations(
              violations,
              "get",
              detailViolations(detail),
              detail,
            );
          }
        }

        if (existsSync(donePath)) {
          break;
        }

        if (Date.now() - startedAt > 30_000) {
          child.kill("SIGTERM");
          throw new Error(
            `writer timeout; stdout=${childStdout} stderr=${childStderr}`,
          );
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
      }

      const done = JSON.parse(readFileSync(donePath, "utf8"));
      assert.deepEqual(done, {
        expected: NOTICE_COUNT,
        ok: true,
        processed: NOTICE_COUNT,
      });
      await waitForExit(child, 5_000);

      const finalSummaries = await reader.list();
      for (const summary of finalSummaries) {
        collectViolations(
          violations,
          "final-list",
          summaryViolations(summary),
          summary,
        );
        const detail = await reader.get(summary.id);
        assert.ok(detail);
        collectViolations(
          violations,
          "final-get",
          detailViolations(detail),
          detail,
        );
      }

      assert.equal(violations.length, 0, JSON.stringify(violations.slice(0, 5)));
      assert.ok(observedUpcoming > 0, "did not observe any upcoming notice");
      assert.ok(observedSent > 0, "did not observe any sent notice");
      assert.ok(lists > 2, `only ${lists} list reads`);
      assert.ok(gets > 2, `only ${gets} detail reads`);
      assert.equal(
        finalSummaries.every((summary) => summary.status === "sent"),
        true,
      );
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 2_000).catch(() => {});
      }
    }
  });
});

function summaryViolations(summary) {
  const violations = [];
  const evidenceComplete =
    summary.aggregate.pending === 0 &&
    summary.aggregate.success +
      summary.aggregate.failed +
      summary.aggregate.unreachable +
      summary.aggregate.unknown ===
      summary.aggregate.total;

  if (
    summary.status === "upcoming" &&
    (summary.aggregate.success > 0 ||
      summary.aggregate.failed > 0 ||
      summary.aggregate.unreachable > 0 ||
      summary.aggregate.unknown > 0)
  ) {
    violations.push("upcoming-with-outcome");
  }

  if (
    summary.status === "upcoming" &&
    summary.activity === "running"
  ) {
    violations.push("upcoming-running");
  }

  if (
    summary.status === "sent" &&
    summary.activity === null &&
    summary.endedAt === null &&
    summary.aggregate.success > 0
  ) {
    violations.push("sent-ended-null-with-success");
  }

  if (
    evidenceComplete &&
    summary.aggregate.success === summary.aggregate.total &&
    (summary.status !== "sent" ||
      summary.endedAt === null ||
      summary.lastExecutedAttemptEndedAt === null)
  ) {
    violations.push("completed-evidence-without-completed-row");
  }

  return violations;
}

function detailViolations(detail) {
  const violations = [];
  const hasCompletedAttempt = detail.attempts.some(
    (attempt) => attempt.phase === "completed",
  );
  const hasExecutedAttempt = detail.attempts.some(
    (attempt) => attempt.executed,
  );

  if (detail.status === "upcoming") {
    if (
      detail.aggregate.success > 0 ||
      detail.aggregate.failed > 0 ||
      detail.aggregate.unreachable > 0 ||
      detail.aggregate.unknown > 0
    ) {
      violations.push("detail-upcoming-with-outcome");
    }

    if (detail.attempts.some((attempt) => attempt.phase !== "queued")) {
      violations.push("detail-upcoming-with-progress");
    }
  }

  if (
    (hasCompletedAttempt || hasExecutedAttempt) &&
    (detail.status !== "sent" || detail.endedAt === null)
  ) {
    violations.push("detail-progress-without-sent-row");
  }

  if (hasExecutedAttempt && detail.lastExecutedAttemptEndedAt === null) {
    violations.push("detail-executed-without-anchor");
  }

  return violations;
}

function collectViolations(target, kind, found, notice) {
  if (found.length === 0) {
    return;
  }

  target.push({
    id: notice.id,
    kinds: found,
    kind,
    status: notice.status,
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`writer did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code });
    });
  });
}
