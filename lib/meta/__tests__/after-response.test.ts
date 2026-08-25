import { describe, expect, it, vi } from "vitest";
import { scheduleAfterResponse } from "@/lib/meta/after-response";

describe("scheduleAfterResponse", () => {
  it("awaits work when after() has no request scope", async () => {
    const seen: string[] = [];
    await scheduleAfterResponse(async () => {
      seen.push("background");
    });
    expect(seen).toEqual(["background"]);
  });

  it("does not drop background work", async () => {
    const task = vi.fn(async () => undefined);
    await scheduleAfterResponse(task);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
