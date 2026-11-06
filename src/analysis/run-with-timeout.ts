export const TIMEOUT = Symbol("analysis-timeout");

/**
 * Races `fn` against a hard timer instead of trusting `fn` to respect the
 * AbortSignal it's given. The signal is still propagated (a well-behaved
 * adapter — and a real LLM SDK — should cancel its in-flight request on
 * abort), but the timer is what guarantees this function returns within
 * `timeoutMs` even if `fn` ignores the signal entirely, per
 * ARCHITECTURE.md §4/§6.
 *
 * If `fn` settles after the timer already won the race, its result is
 * deliberately discarded (never persisted) — a late response must not
 * overwrite the terminal row the timeout branch already wrote.
 */
export async function runWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT> {
  const controller = new AbortController();

  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
    timer.unref();
  });

  const run = Promise.resolve()
    .then(() => fn(controller.signal))
    .finally(() => clearTimeout(timer));

  // A late rejection (after `timeout` already won the race) must not
  // surface as an unhandled rejection: Promise.race leaves this listener
  // attached regardless of which promise it reads from.
  run.catch(() => {});

  return Promise.race([run, timeout]);
}
