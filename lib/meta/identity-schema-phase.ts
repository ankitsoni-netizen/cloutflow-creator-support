/**
 * Three-phase identity rollout.
 *
 * Phase A (default): schema-compatible containment. Never selects or writes
 * identity_status, provider, recipient_account_id, or the identity RPC.
 * Safe to deploy against the current Production schema.
 *
 * Phase B: additive migration. Compatible with Phase A application code.
 *
 * Phase C: IDENTITY_SCHEMA_PHASE=c. Selects the new columns and uses the
 * identity RPC. Deploy only after Phase B. Against the old schema this
 * phase must fail closed, not fall back.
 */
export type IdentitySchemaPhase = "a" | "c";

export const IDENTITY_SCHEMA_UNAVAILABLE = "identity_schema_unavailable";

export function identitySchemaPhase(): IdentitySchemaPhase {
  const value = process.env.IDENTITY_SCHEMA_PHASE?.trim().toLowerCase();
  return value === "c" ? "c" : "a";
}

export function isIdentitySchemaPhaseC(): boolean {
  return identitySchemaPhase() === "c";
}

export function runWithIdentitySchemaPhase<T>(
  phase: IdentitySchemaPhase,
  fn: () => T,
): T {
  const previous = process.env.IDENTITY_SCHEMA_PHASE;
  process.env.IDENTITY_SCHEMA_PHASE = phase;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.IDENTITY_SCHEMA_PHASE;
    else process.env.IDENTITY_SCHEMA_PHASE = previous;
  }
}

export async function runWithIdentitySchemaPhaseAsync<T>(
  phase: IdentitySchemaPhase,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.IDENTITY_SCHEMA_PHASE;
  process.env.IDENTITY_SCHEMA_PHASE = phase;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.IDENTITY_SCHEMA_PHASE;
    else process.env.IDENTITY_SCHEMA_PHASE = previous;
  }
}
