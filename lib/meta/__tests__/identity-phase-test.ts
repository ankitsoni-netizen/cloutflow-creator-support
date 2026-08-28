import { afterEach, beforeEach } from "vitest";
import type { IdentitySchemaPhase } from "@/lib/meta/identity-schema-phase";

/**
 * Pin IDENTITY_SCHEMA_PHASE for this file's tests, then restore whatever the
 * process had — including after thrown assertions. Does not set a Vitest-global
 * default phase. Tests that switch phases should still wrap with
 * runWithIdentitySchemaPhase / runWithIdentitySchemaPhaseAsync so each
 * assertion owns its phase.
 *
 * Restoration is stack-based so nested beforeEach/afterEach in the same file
 * cannot clobber an outer pin. Tests in this suite must not use it.concurrent:
 * process.env is process-wide within a worker.
 */
export function pinIdentitySchemaPhase(phase: IdentitySchemaPhase): void {
  const previousByTest: Array<string | undefined> = [];
  beforeEach(() => {
    previousByTest.push(process.env.IDENTITY_SCHEMA_PHASE);
    process.env.IDENTITY_SCHEMA_PHASE = phase;
  });
  afterEach(() => {
    const previous = previousByTest.pop();
    if (previous === undefined) delete process.env.IDENTITY_SCHEMA_PHASE;
    else process.env.IDENTITY_SCHEMA_PHASE = previous;
  });
}
