import { describe, expect, it, vi } from "vitest";
import { runWithTimeout, TIMEOUT } from "../../src/analysis/run-with-timeout.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runWithTimeout", () => {
  it("returns the function's result when it settles before the timeout", async () => {
    const result = await runWithTimeout(async () => "done", 200);
    expect(result).toBe("done");
  });

  it("returns TIMEOUT when the function never settles, even if it ignores the AbortSignal", async () => {
    // Simulates an adapter that doesn't honor cancellation: it just sleeps
    // past the budget. runWithTimeout must still resolve on time.
    const start = Date.now();
    const result = await runWithTimeout(async () => {
      await delay(500);
      return "too-late";
    }, 50);
    expect(result).toBe(TIMEOUT);
    expect(Date.now() - start).toBeLessThan(400);
  });

  it("propagates a rejection from the function when it rejects before the timeout", async () => {
    await expect(
      runWithTimeout(async () => {
        throw new Error("adapter blew up");
      }, 200),
    ).rejects.toThrow("adapter blew up");
  });

  it("aborts the signal when the timeout wins", async () => {
    let observedAborted = false;
    await runWithTimeout(async (signal) => {
      await delay(100);
      observedAborted = signal.aborted;
      return "value";
    }, 20);
    await delay(100);
    expect(observedAborted).toBe(true);
  });

  it("discards a late rejection without an unhandled rejection after the timeout already won", async () => {
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    const result = await runWithTimeout(async () => {
      await delay(80);
      throw new Error("late failure, must be swallowed");
    }, 20);

    expect(result).toBe(TIMEOUT);
    await delay(150); // let the late rejection actually fire and be caught
    expect(unhandled).not.toHaveBeenCalled();
  });
});
