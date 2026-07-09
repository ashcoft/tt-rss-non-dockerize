/**
 * Run a promise without awaiting it, reporting any rejection instead of letting
 * it surface as an unhandled rejection.
 *
 * This is the deliberate alternative to the `void` operator for fire-and-forget
 * calls: `void` silences the linter but still leaves the rejection unhandled,
 * whereas this attaches a handler. Use it where the callee is expected to
 * report its own errors through state (a store's `error` ref, a dialog message)
 * and the caller has nothing further to do.
 *
 * @param promise the work to run
 * @param context short label used in the console message if it rejects
 */
export function runDetached(promise: Promise<unknown>, context: string): void {
  promise.catch((err: unknown) => {
    console.error(`${context} failed:`, err);
  });
}
