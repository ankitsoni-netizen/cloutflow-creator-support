import "server-only";

import { after } from "next/server";

/**
 * Schedule work to run after the HTTP response is sent.
 * Inside a Next.js request (`after()` available) this does not block the
 * response. Outside a request (unit tests) the work is awaited so it is never
 * fire-and-forget.
 */
export async function scheduleAfterResponse(
  task: () => Promise<void>,
): Promise<void> {
  try {
    after(task);
  } catch {
    await task();
  }
}
