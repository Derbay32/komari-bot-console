import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setImmediate as flushMacrotask } from "node:timers/promises";

import ts from "typescript";
import {
  QueryClient,
  QueryObserver,
  MutationObserver,
} from "@tanstack/react-query";

// Import the real helper under test without a TS loader or temp files:
// transpile src/lib/async.ts in memory and load it as a data: JS URL.
const helperPath = fileURLToPath(
  new URL("../../src/lib/async.ts", import.meta.url),
);
const helperSource = readFileSync(helperPath, "utf8");
const { outputText: helperJs } = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`;
const { observePromise, observeCallback, withReportedErrors } = await import(helperUrl);

// One macrotask tick drains all pending microtasks; no real-time sleeps.
const flush = async (times = 2) => {
  for (let i = 0; i < times; i += 1) {
    await flushMacrotask();
  }
};

describe("observePromise", () => {
  it("returns undefined synchronously while the promise is still pending", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    let resolvePending;
    const pending = new Promise((resolve) => {
      resolvePending = resolve;
    });

    const result = observePromise(pending);

    assert.equal(result, undefined);

    resolvePending("done");
    await flush();
    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("does not log when the observed promise resolves", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});

    observePromise(Promise.resolve("ok"));
    await flush();

    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("logs the same rejection error exactly once and keeps it handled", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("boom");

    observePromise(Promise.reject(failure));
    await flush();

    assert.equal(errorSpy.mock.callCount(), 1);
    const callArgs = errorSpy.mock.calls[0].arguments;
    assert.equal(typeof callArgs[0], "string");
    assert.equal(callArgs[callArgs.length - 1], failure);
    // node:test fails the run on any unhandledRejection, so reaching this
    // point proves the observed rejection was handled.
  });

  it("observes a callable MessageType-like thenable without calling its close function", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    let thenCalls = 0;
    const innerPromise = Promise.resolve("closed later");
    // Antd-style message handle: itself the close function, with a then method.
    const messageLike = t.mock.fn(() => {});
    messageLike.then = (...callbacks) => {
      thenCalls += 1;
      return innerPromise.then(...callbacks);
    };

    const result = observePromise(messageLike);
    await flush();

    assert.equal(result, undefined);
    assert.ok(thenCalls >= 1, "the thenable must actually be observed");
    assert.equal(
      messageLike.mock.callCount(),
      0,
      "observing must not trigger the close behavior",
    );
    assert.equal(errorSpy.mock.callCount(), 0);
  });
});

describe("observeCallback", () => {
  it("does not invoke the action when the wrapper is created", (t) => {
    const action = t.mock.fn(async () => {});

    const callback = observeCallback(action);

    assert.equal(typeof callback, "function");
    assert.equal(action.mock.callCount(), 0);
  });

  it("forwards arguments exactly once, runs immediately, and returns void before deferred completion", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let completed = false;
    const action = t.mock.fn(async (...args) => {
      await gate;
      completed = true;
      return args;
    });
    const callback = observeCallback(action);

    const detail = { key: true };
    const result = callback("a", 1, detail);

    // The action starts synchronously, exactly once, with the exact arguments.
    assert.equal(action.mock.callCount(), 1);
    assert.deepEqual(action.mock.calls[0].arguments, ["a", 1, detail]);
    assert.equal(action.mock.calls[0].arguments[2], detail);
    // The wrapped callback returns void immediately, before completion.
    assert.equal(result, undefined);
    assert.equal(completed, false);

    await flush();
    assert.equal(completed, false);
    assert.equal(errorSpy.mock.callCount(), 0);

    release();
    await flush();
    assert.equal(completed, true);
    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("logs an async callback rejection exactly once without rethrowing to the caller", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("deferred failure");
    const callback = observeCallback(async () => {
      throw failure;
    });

    assert.doesNotThrow(() => callback());
    await flush();

    assert.equal(errorSpy.mock.callCount(), 1);
    const callArgs = errorSpy.mock.calls[0].arguments;
    assert.equal(callArgs[callArgs.length - 1], failure);
  });

  it("lets a synchronous throw from the callback propagate to the caller", (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("sync failure");
    const callback = observeCallback(() => {
      throw failure;
    });

    let caught;
    try {
      callback();
    } catch (error) {
      caught = error;
    }

    assert.equal(caught, failure);
    assert.equal(errorSpy.mock.callCount(), 0);
  });
});

describe("react-query integration", () => {
  it("mutation reaches success while the observed invalidation refetch is still pending, then the deferred result updates the cache", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const client = new QueryClient();
    const queryKey = ["observed", "deferred-refetch"];

    client.setQueryData(queryKey, "initial");

    let refetchStarted = false;
    let releaseRefetch;
    const queryFn = () => {
      refetchStarted = true;
      return new Promise((resolve) => {
        releaseRefetch = resolve;
      });
    };

    const queryObserver = new QueryObserver(client, {
      queryKey,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribeQuery = queryObserver.subscribe(() => {});

    // Fresh cached data plus staleTime Infinity: subscribing must not refetch.
    assert.equal(refetchStarted, false);
    assert.equal(client.getQueryData(queryKey), "initial");

    const mutationObserver = new MutationObserver(client, {
      mutationFn: async () => "mutation-result",
      onSuccess: () => {
        // Observed on purpose: not returned, not awaited, so the invalidation
        // must not delay the mutation's own success state.
        observePromise(client.invalidateQueries({ queryKey }));
      },
    });
    const seenStatuses = [];
    const unsubscribeMutation = mutationObserver.subscribe((mutationResult) => {
      seenStatuses.push(mutationResult.status);
    });

    try {
      mutationObserver.mutate();
      await flush();

      // The mutation is already successful...
      assert.equal(mutationObserver.getCurrentResult().status, "success");
      assert.deepEqual(seenStatuses, ["pending", "success"]);
      // ...while the invalidation-triggered refetch is still in flight...
      assert.equal(refetchStarted, true);
      assert.equal(client.getQueryData(queryKey), "initial");
      // ...and nothing unexpected was logged.
      assert.equal(errorSpy.mock.callCount(), 0);

      releaseRefetch("updated");
      await flush();

      assert.equal(client.getQueryData(queryKey), "updated");
      assert.equal(errorSpy.mock.callCount(), 0);
    } finally {
      unsubscribeMutation();
      unsubscribeQuery();
      client.clear();
    }
  });
});

describe("Promise-aware action error boundary", () => {
  it("starts only when called and preserves pending state, arguments and result", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const action = t.mock.fn(async (value) => { await gate; return value; });
    const onOk = withReportedErrors(action);
    assert.equal(action.mock.callCount(), 0);
    const value = { saved: true };
    const pending = onOk(value);
    assert.ok(pending instanceof Promise);
    assert.deepEqual(action.mock.calls[0].arguments, [value]);
    let settled = false;
    const completion = pending.then((result) => { settled = true; return result; });
    await flush();
    assert.equal(settled, false);
    release();
    assert.equal(await completion, value);
    assert.equal(errorSpy.mock.callCount(), 0);
  });

  it("logs an async failure once and propagates the original rejection", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("action failed");
    const onOk = withReportedErrors(async () => { throw failure; });
    await assert.rejects(onOk(), (error) => error === failure);
    assert.equal(errorSpy.mock.callCount(), 1);
    assert.equal(errorSpy.mock.calls[0].arguments.at(-1), failure);
  });

  it("also logs synchronous setup failures before returning a rejected Promise", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("request ID setup failed");
    const onOk = withReportedErrors(() => { throw failure; });
    let pending;
    assert.doesNotThrow(() => { pending = onOk(); });
    await assert.rejects(pending, (error) => error === failure);
    assert.equal(errorSpy.mock.callCount(), 1);
    assert.equal(errorSpy.mock.calls[0].arguments.at(-1), failure);
  });

  it("records the rejection even if a Promise-aware consumer suppresses it", async (t) => {
    const errorSpy = t.mock.method(console, "error", () => {});
    const failure = new Error("silent modal failure");
    const onOk = withReportedErrors(async () => { throw failure; });
    let closed = false;
    let received;
    await onOk().then(() => { closed = true; }, (error) => { received = error; });
    assert.equal(closed, false);
    assert.equal(received, failure);
    assert.equal(errorSpy.mock.callCount(), 1);
    assert.equal(errorSpy.mock.calls[0].arguments.at(-1), failure);
  });
});
