import { describe, expect, it, vi } from "vitest";
import {
  createInstagramTimingSession,
  INSTAGRAM_TIMING_METRICS,
  INSTAGRAM_TIMING_PHASES,
  isInstagramTimingLog,
} from "@/lib/meta/timing";

describe("instagram webhook timing logs", () => {
  it("logs phase durations only", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    let t = 0;
    const session = createInstagramTimingSession(() => {
      t += 12.4;
      return t;
    });
    session.mark("signature_verified");
    session.mark("event_claimed");
    session.record("instagram_reduce_ms", 12);
    session.flush();
    const logged = info.mock.calls.map((call) => JSON.stringify(call)).join(" ");
    expect(logged).toContain("instagram webhook timing");
    expect(logged).toContain("signature_verified");
    expect(logged).toContain("event_claimed");
    expect(logged).toContain("instagram_reduce_ms");
    expect(logged).toContain("instagram_webhook_total_ms");
    expect(logged).toContain("elapsedMs");
    expect(logged).not.toContain("riya@example.com");
    expect(logged).not.toContain("9876543210");
    expect(logged).not.toContain("12334");
    expect(logged).not.toContain("sha256=");
    expect(logged).not.toContain("IGSID");
    expect(logged).not.toContain("Bearer");
    expect(isInstagramTimingLog({ phase: "event_claimed", elapsedMs: 12 })).toBe(
      true,
    );
    expect(isInstagramTimingLog({ metric: "instagram_reduce_ms", elapsedMs: 12 })).toBe(
      true,
    );
    expect(INSTAGRAM_TIMING_PHASES).toContain("critical_path_completed");
    expect(INSTAGRAM_TIMING_METRICS).toContain("instagram_sender_action_ms");
    info.mockRestore();
  });
});
