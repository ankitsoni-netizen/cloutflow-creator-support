import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client that bypasses end-user session RLS.
 * Used for public website intake and future webhook/channel ingest.
 *
 * Prefer SUPABASE_SECRET_KEY (current Supabase secret naming).
 * Falls back to SUPABASE_SERVICE_ROLE_KEY for older projects / local setups.
 * Never expose either key via NEXT_PUBLIC_* variables.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    throw new Error("Supabase admin client is not configured.");
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
