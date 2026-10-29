import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { loadTypeScriptModule } from "./typescript-modules.mjs";

const maintenanceUrl = loadTypeScriptModule("src/lib/maintenance.ts");
const maintenance = await import(maintenanceUrl);

describe("maintenance input validation", () => {
  it("trims required text, preserves internal newlines, and normalizes immediate mode", () => {
    const input = maintenance.parseMaintenanceCreateInput({
      content: "  第一行\n第二行  ",
      groupIds: [12, 7],
      maintenanceTime: "  2026-11-01 22:00 - 23:00  ",
      mode: "immediate",
      plannedAt: null,
      title: "  维护通知  ",
    });

    assert.deepEqual(input, {
      content: "第一行\n第二行",
      groupIds: [12, 7],
      maintenanceTime: "2026-11-01 22:00 - 23:00",
      mode: "immediate",
      plannedAt: null,
      title: "维护通知",
    });
  });

  it("rejects blank text without truncating it first", () => {
    for (const field of ["title", "content", "maintenanceTime"]) {
      const patch = { [field]: " \n\t " };
      assert.throws(
        () => maintenance.parseMaintenanceCreateInput(validInput(patch)),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /不能为空/);
          return true;
        },
      );
    }
  });

  it("rejects lone surrogate code points", () => {
    for (const field of ["title", "content", "maintenanceTime"]) {
      const patch = { [field]: "前\uD800后" };
      assert.throws(
        () => maintenance.parseMaintenanceCreateInput(validInput(patch)),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /无效的 Unicode/);
          return true;
        },
      );
    }
  });

  it("enforces codepoint budgets before byte and token budgets", () => {
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ title: "a".repeat(129) }),
        ),
      {
        message: "标题不能超过 128 个字符。",
      },
    );
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ content: "a".repeat(3001) }),
        ),
      {
        message: "正文不能超过 3000 个字符。",
      },
    );
  });

  it("enforces UTF-8 byte budgets for content", () => {
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ content: "😀".repeat(3000) }),
        ),
      {
        message: "正文 UTF-8 编码不能超过 9000 字节。",
      },
    );
  });

  it("enforces estimated token budgets for title and maintenance time", () => {
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ title: "😀".repeat(128) }),
        ),
      {
        message: "标题估算 token 不能超过 128。",
      },
    );
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ maintenanceTime: "😀".repeat(128) }),
        ),
      {
        message: "维护时间估算 token 不能超过 128。",
      },
    );
  });

  it("accepts text exactly at codepoint, byte, and token boundaries", () => {
    const input = maintenance.parseMaintenanceCreateInput(
      validInput({
        content: "维".repeat(3000),
        maintenanceTime: "维".repeat(128),
        title: "维".repeat(128),
      }),
    );

    assert.equal(maintenance.countCodepoints(input.content), 3000);
    assert.equal(new TextEncoder().encode(input.content).byteLength, 9000);
    assert.equal(maintenance.estimateMaintenanceTokens(input.title), 128);
    assert.equal(maintenance.estimateMaintenanceTokens(input.content), 3000);
  });

  it("requires positive, unique, safe group identifiers inside the published cap", () => {
    const invalidGroups = [
      [],
      [0],
      [-1],
      [1.5],
      [Number.MAX_SAFE_INTEGER + 1],
      ["1"],
      [1, 1],
      Array.from({ length: 101 }, (_value, index) => index + 1),
    ];

    for (const groupIds of invalidGroups) {
      assert.throws(
        () => maintenance.parseMaintenanceCreateInput(validInput({ groupIds })),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /群|100|安全整数/);
          return true;
        },
      );
    }
  });

  it("rejects scheduling at the public immediate-only boundary", () => {
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ mode: "scheduled", plannedAt: Date.now() + 60_000 }),
        ),
      { message: "当前仅支持立即发送。" },
    );
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ plannedAt: Date.now() + 60_000 }),
        ),
      { message: "立即发送的通知不能设置计划时间。" },
    );
    assert.throws(
      () =>
        maintenance.parseMaintenanceCreateInput(
          validInput({ mode: "later" }),
        ),
      { message: "当前仅支持立即发送。" },
    );
  });

  it("rejects unknown fields and non-object payloads", () => {
    for (const payload of [
      null,
      [],
      "text",
      { ...validInput(), extra: true },
    ]) {
      assert.throws(() => maintenance.parseMaintenanceCreateInput(payload), {
        name: "MaintenanceInputError",
      });
    }
  });

  it("validates submission keys as 1 to 64 ASCII identifier characters", () => {
    for (const key of [
      "a",
      "web-announce-1",
      "A1_.:-",
      "a".repeat(64),
    ]) {
      assert.equal(maintenance.validateMaintenanceSubmissionId(key), key);
    }

    for (const key of [
      "",
      "-starts-with-punctuation",
      "contains space",
      "中文",
      "a".repeat(65),
      null,
      undefined,
    ]) {
      assert.throws(
        () => maintenance.validateMaintenanceSubmissionId(key),
        (error) => {
          assert.equal(error.name, "MaintenanceInputError");
          assert.match(error.message, /X-Request-ID/);
          return true;
        },
      );
    }
  });
});

describe("maintenance notice aggregate rules", () => {
  it("keeps verified nonparticipant outcomes while a reconciliation attempt blocks affected targets", () => {
    const attempts = [
      executedAttempt([1, 2, 3], [
        result(1, "success", "发送成功"),
        result(2, "success", "发送成功"),
        result(3, "success", "发送成功"),
      ]),
      {
        ...rejectedAttempt([2], "存在进行中的请求"),
        requiresReconciliation: true,
      },
    ];

    const aggregate = maintenance.buildMaintenanceAggregate([1, 2, 3], attempts);

    assert.deepEqual(
      aggregate.perGroup.map((target) => [target.groupId, target.outcome]),
      [
        [1, "success"],
        [2, "unknown"],
        [3, "success"],
      ],
    );
    assert.deepEqual(aggregate.blockedGroupIds, [2]);
    assert.equal(aggregate.requiresReconciliation, true);
    assert.equal(aggregate.allSuccess, false);
    assert.equal(aggregate.success, 2);
    assert.equal(aggregate.unknown, 1);
    assert.match(aggregate.perGroup[1].reason, /存在进行中的请求/);
  });

  it("blocks a 409 target even when an older attempt reported a definite failure", () => {
    const aggregate = maintenance.buildMaintenanceAggregate(
      [2, 3],
      [
        executedAttempt([2, 3], [
          result(2, "failed", "发送失败"),
          {
            ...result(3, "unknown", "投递结果未知，需人工核对"),
            requiresReconciliation: true,
          },
        ]),
        {
          ...rejectedAttempt([2], "请求仍在处理中"),
          requiresReconciliation: true,
        },
      ],
    );

    assert.equal(aggregate.perGroup[0].outcome, "unknown");
    assert.equal(aggregate.perGroup[0].retryBlocked, true);
    assert.match(aggregate.perGroup[0].reason, /请求仍在处理中/);
    assert.equal(aggregate.perGroup[1].retryBlocked, true);
    assert.deepEqual(aggregate.blockedGroupIds, [2, 3]);
  });

  it("preserves prior executed outcomes after an ordinary 429 rejection", () => {
    const aggregate = maintenance.buildMaintenanceAggregate(
      [1, 2],
      [
        executedAttempt([1, 2], [
          result(1, "success", "发送成功"),
          result(2, "failed", "发送失败"),
        ]),
        rejectedAttempt([1], "请求过于频繁", 15),
      ],
    );

    assert.deepEqual(
      aggregate.perGroup.map((target) => target.outcome),
      ["success", "failed"],
    );
    assert.deepEqual(aggregate.blockedGroupIds, []);
    assert.equal(aggregate.requiresReconciliation, false);
    assert.equal(aggregate.allSuccess, false);
  });

  it("surfaces an ordinary cooldown rejection as unknown without blocking retry", () => {
    const aggregate = maintenance.buildMaintenanceAggregate(
      [4, 5],
      [rejectedAttempt([4, 5], "请求过于频繁", 30)],
    );

    assert.deepEqual(
      aggregate.perGroup.map((target) => target.outcome),
      ["unknown", "unknown"],
    );
    assert.deepEqual(aggregate.blockedGroupIds, []);
    assert.equal(aggregate.requiresReconciliation, false);
    assert.equal(aggregate.pending, 0);
    assert.match(aggregate.perGroup[0].reason, /剩余冷却 30 秒/);
  });

  it("keeps ambiguous executed evidence uncertain and blocks automatic retry", () => {
    const aggregate = maintenance.buildMaintenanceAggregate(
      [9],
      [
        executedAttempt([9], [
          {
            ...result(9, "unknown", "投递结果未知，需人工核对"),
            requiresReconciliation: true,
          },
        ]),
      ],
    );

    assert.equal(aggregate.perGroup[0].outcome, "unknown");
    assert.equal(aggregate.perGroup[0].retryBlocked, true);
    assert.deepEqual(aggregate.blockedGroupIds, [9]);
    assert.equal(aggregate.allSuccess, false);
  });

  it("treats missing results on executed attempts as unknown rather than failed", () => {
    const aggregate = maintenance.buildMaintenanceAggregate(
      [1, 2],
      [executedAttempt([1, 2], [result(1, "success", "发送成功")])],
    );

    assert.deepEqual(
      aggregate.perGroup.map((target) => [target.outcome, target.reason]),
      [
        ["success", "发送成功"],
        ["unknown", "上游未返回结果"],
      ],
    );
    assert.equal(aggregate.failed, 0);
    assert.equal(aggregate.allSuccess, false);
  });

  it("reports pending targets only before any attempt produces evidence", () => {
    const queued = {
      executed: false,
      phase: "queued",
      remainingSeconds: null,
      requestError: null,
      requiresReconciliation: false,
      results: [],
      targetGroupIds: [1, 2],
    };
    const aggregate = maintenance.buildMaintenanceAggregate([1, 2], [queued]);

    assert.equal(aggregate.pending, 2);
    assert.equal(aggregate.allSuccess, false);
  });

  it("claims aggregate-wide success only when every original target has verified success", () => {
    const complete = maintenance.buildMaintenanceAggregate(
      [1, 2],
      [
        executedAttempt([1, 2], [
          result(1, "success", "发送成功"),
          result(2, "success", "发送成功"),
        ]),
      ],
    );
    const partial = maintenance.buildMaintenanceAggregate(
      [1, 2],
      [executedAttempt([1], [result(1, "success", "发送成功")])],
    );

    assert.equal(complete.allSuccess, true);
    assert.equal(partial.allSuccess, false);
    assert.equal(partial.pending, 1);
  });
});

function validInput(patch = {}) {
  return {
    content: "维护内容",
    groupIds: [1, 2],
    maintenanceTime: "2026-11-01 22:00",
    mode: "immediate",
    plannedAt: null,
    title: "维护标题",
    ...patch,
  };
}

function executedAttempt(targetGroupIds, results) {
  return {
    executed: true,
    phase: "completed",
    remainingSeconds: null,
    requestError: null,
    requiresReconciliation: false,
    results,
    targetGroupIds,
  };
}

function rejectedAttempt(targetGroupIds, requestError, remainingSeconds = null) {
  return {
    executed: false,
    phase: "completed",
    remainingSeconds,
    requestError,
    requiresReconciliation: false,
    results: [],
    targetGroupIds,
  };
}

function result(groupId, outcome, reason) {
  return {
    botId: null,
    error: null,
    errorCode: null,
    groupId,
    outcome,
    reason,
    requiresReconciliation: false,
  };
}
