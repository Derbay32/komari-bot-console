/**
 * Observe work that must not delay the current interaction (for example,
 * background query refreshes or a toast's close notification). Business errors
 * remain with the caller's existing UI handling; unexpected rejections are
 * recorded rather than discarded. Do not use this for work that must be awaited.
 */
export function observePromise(promise: PromiseLike<unknown>): void {
  Promise.resolve(promise).catch((error: unknown) => {
    console.error("后台异步操作失败", error);
  });
}

/**
 * Log failures at the action boundary while preserving its result/rejection.
 * Promise-aware consumers still control loading and close behavior, even when
 * their confirmation-result Promise does not expose action failures.
 */
export function withReportedErrors<Args extends unknown[], Result>(
  action: (...args: Args) => PromiseLike<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      console.error("异步操作失败", error);
      throw error;
    }
  };
}

/** Adapt an async action to a void callback whose consumer does not await it. */
export function observeCallback<Args extends unknown[]>(
  callback: (...args: Args) => PromiseLike<unknown>,
): (...args: Args) => void {
  return (...args) => {
    observePromise(callback(...args));
  };
}
