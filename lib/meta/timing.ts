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

export const INSTAGRAM_TIMING_METRICS = [
  "instagram_webhook_total_ms",
  "instagram_durable_ingest_ms",
  "instagram_reduce_ms",
  "instagram_reserve_ms",
  "instagram_sender_action_ms",
  "instagram_graph_send_ms",
  "instagram_ticket_create_ms",
  "instagram_after_scheduled",
] as const;

export type InstagramTimingMetric = (typeof INSTAGRAM_TIMING_METRICS)[number];

export type InstagramTimingSession = {
  mark(phase: InstagramTimingPhase): void;
  record(metric: InstagramTimingMetric, value: number): void;
  elapsedMs(phase?: InstagramTimingPhase): number;
  now(): number;
  flush(): void;
};

const TIMING_LOG_PREFIX = "instagram webhook timing";

export function createInstagramTimingSession(
  now: () => number = () => performance.now(),
): InstagramTimingSession {
  const startedAt = now();
  const marks: Partial<Record<InstagramTimingPhase, number>> = {};
  const metrics: Partial<Record<InstagramTimingMetric, number>> = {};

  return {
    now,
    mark(phase) {
      const elapsedMs = Math.max(0, Math.round(now() - startedAt));
      marks[phase] = elapsedMs;
      console.info(TIMING_LOG_PREFIX, { phase, elapsedMs });
    },
    record(metric, value) {
      const elapsedMs = Math.max(0, Math.round(value));
      metrics[metric] = elapsedMs;
    },
    elapsedMs(phase) {
      if (phase) return marks[phase] ?? Math.max(0, Math.round(now() - startedAt));
      return Math.max(0, Math.round(now() - startedAt));
    },
    flush() {
      if (metrics.instagram_webhook_total_ms == null) {
        metrics.instagram_webhook_total_ms = Math.max(
          0,
          Math.round(now() - startedAt),
        );
      }
      for (const metric of INSTAGRAM_TIMING_METRICS) {
        const elapsedMs = metrics[metric];
        if (elapsedMs == null) continue;
        console.info(TIMING_LOG_PREFIX, { metric, elapsedMs });
      }
    },
  };
}

export async function timeInstagramMetric<T>(
  timing: InstagramTimingSession | undefined,
  metric: InstagramTimingMetric,
  work: () => Promise<T>,
): Promise<T> {
  const started = timing?.now() ?? 0;
  try {
    return await work();
  } finally {
    if (timing) {
      timing.record(metric, timing.now() - started);
    }
  }
}

export function isInstagramTimingLog(value: unknown): boolean {
  if (value === TIMING_LOG_PREFIX) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.metric === "string" &&
    INSTAGRAM_TIMING_METRICS.includes(record.metric as InstagramTimingMetric) &&
    typeof record.elapsedMs === "number"
  ) {
    return true;
  }
  return (
    typeof record.phase === "string" &&
    INSTAGRAM_TIMING_PHASES.includes(record.phase as InstagramTimingPhase) &&
    typeof record.elapsedMs === "number"
  );
}
