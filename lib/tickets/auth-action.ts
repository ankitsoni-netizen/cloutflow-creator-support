"use server";

import type { User } from "@supabase/supabase-js";
import type { StaffProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logSupabaseError } from "@/lib/tickets/errors";

export type ActionStaffContext =
  | { ok: true; user: User; profile: StaffProfile; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: string };

export async function getActiveStaffContext(): Promise<ActionStaffContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: "Your session expired. Please sign in again." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("staff_profiles")
    .select("user_id, full_name, role, team, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) {
    logSupabaseError("staff_profiles action lookup failed", profileError);
    return {
      ok: false,
      error: "Unable to verify staff access. Please try again.",
    };
  }

  if (!profile) {
    return {
      ok: false,
      error: "Your account is not authorized for Creator Support.",
    };
  }

  const fullName = profile.full_name?.trim();
  if (!fullName) {
    return {
      ok: false,
      error: "Your staff profile is missing a full name. Contact an administrator.",
    };
  }

  return {
    ok: true,
    user,
    profile: {
      ...(profile as StaffProfile),
      full_name: fullName,
    },
    supabase,
  };
}
