import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdminClient: SupabaseClient | null = null;
let cachedAdminClientKey: string | null = null;

/**
 * Server-only Supabase client that bypasses end-user session RLS.
 * Used for public website intake and future webhook/channel ingest.
 *
 * Prefer SUPABASE_SECRET_KEY (current Supabase secret naming).
 * Falls back to SUPABASE_SERVICE_ROLE_KEY for older projects / local setups.
 * Never expose either key via NEXT_PUBLIC_* variables.
 *
 * The client is module-scoped so webhook invocations reuse one connection
 * pool instead of constructing a new client per request.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    throw new Error("Supabase admin client is not configured.");
  }

  const cacheKey = `${url}:${secretKey}`;
  if (cachedAdminClient && cachedAdminClientKey === cacheKey) {
    return cachedAdminClient;
  }

  cachedAdminClient = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  cachedAdminClientKey = cacheKey;
  return cachedAdminClient;
}

/** Test helper — drops the cached admin client between diagnostic runs. */
export function resetAdminClientForTests(): void {
  cachedAdminClient = null;
  cachedAdminClientKey = null;
}
