const WINDOW_MS = 60_000;
const MAX_ACTIONS = 20;

const hits = new Map<string, number[]>();

export function resetStaffActionRateLimitForTests(): void {
  hits.clear();
}

export function consumeStaffActionRateLimit(
  userId: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  const previous = hits.get(userId) ?? [];
  const recent = previous.filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_ACTIONS) {
    hits.set(userId, recent);
    return {
      ok: false,
      error: "Too many replies in a short time. Please wait a moment and try again.",
    };
  }
  recent.push(now);
  hits.set(userId, recent);
  return { ok: true };
}
