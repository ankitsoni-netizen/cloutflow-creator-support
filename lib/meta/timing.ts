/**
 * Privacy-safe Instagram webhook phase timings.
 * Logs durations only. Never log payloads, message text, email, phone,
 * IGSID, tokens, signatures, or secrets.
 */

export const INSTAGRAM_TIMING_PHASES = [
  "signature_verified",
  "event_claimed",
  "conversation_loaded",
  "inbound_stored",
  "state_reduced",
  "outbound_reserved",
  "meta_send_completed",
  "critical_path_completed",
  "background_work_completed",
] as const;

export type InstagramTimingPhase = (typeof INSTAGRAM_TIMING_PHASES)[number];

export type InstagramTimingSession = {
  mark(phase: InstagramTimingPhase): void;
  elapsedMs(phase?: InstagramTimingPhase): number;
};

const TIMING_LOG_PREFIX = "instagram webhook timing";

export function createInstagramTimingSession(
  now: () => number = () => performance.now(),
): InstagramTimingSession {
  const startedAt = now();
  const marks: Partial<Record<InstagramTimingPhase, number>> = {};

  return {
    mark(phase) {
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      marks[phase] = elapsedMs;
      console.info(TIMING_LOG_PREFIX, { phase, elapsedMs });
    },
    elapsedMs(phase) {
      if (phase) return marks[phase] ?? Math.max(0, Math.round(now() - startedAt));
      return Math.max(0, Math.round(now() - startedAt));
    },
  };
}

export function isInstagramTimingLog(value: unknown): boolean {
  if (value === TIMING_LOG_PREFIX) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.phase === "string" &&
    INSTAGRAM_TIMING_PHASES.includes(record.phase as InstagramTimingPhase) &&
    typeof record.elapsedMs === "number"
  );
}
