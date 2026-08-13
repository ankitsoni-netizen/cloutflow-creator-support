import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveStaffContext,
  type ActionStaffContext,
} from "@/lib/tickets/auth-action";
import { logSupabaseError } from "@/lib/tickets/errors";
import type { StaffDirectoryMember } from "@/lib/types";
import { isAdminRole } from "@/lib/team/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SetStaffActiveInput = {
  userId: string;
  isActive: boolean;
};

export type SetStaffActiveResult =
  | { ok: true; member: StaffDirectoryMember }
  | { ok: false; error: string };

export type SetStaffActiveDeps = {
  getStaffContext?: () => Promise<ActionStaffContext>;
  createAdmin?: () => SupabaseClient;
};

/**
 * Admin-only: soft-enable or soft-disable a staff member via is_active.
 * Admins cannot disable their own account.
 */
export async function setStaffActive(
  input: SetStaffActiveInput,
  deps: SetStaffActiveDeps = {},
): Promise<SetStaffActiveResult> {
  const getStaffContext = deps.getStaffContext ?? getActiveStaffContext;
  const createAdmin = deps.createAdmin ?? createAdminClient;

  const context = await getStaffContext();
  if (!context.ok) {
    return { ok: false, error: context.error };
  }
  if (!isAdminRole(context.profile.role)) {
    return {
      ok: false,
      error: "Only Admins can change team member status.",
    };
  }

  const userId = input.userId.trim();
  if (!userId) {
    return { ok: false, error: "Staff member is required." };
  }

  if (!input.isActive && userId === context.user.id) {
    return {
      ok: false,
      error: "You cannot disable your own account.",
    };
  }

  let admin: SupabaseClient;
  try {
    admin = createAdmin();
  } catch {
    return {
      ok: false,
      error: "Team updates are temporarily unavailable. Please try again later.",
    };
  }

  const { data, error } = await admin
    .from("staff_profiles")
    .update({ is_active: input.isActive })
    .eq("user_id", userId)
    .select("user_id, full_name, role, team, is_active")
    .maybeSingle();

  if (error) {
    logSupabaseError("staff_profiles is_active update failed", error);
    return {
      ok: false,
      error: "Unable to update staff status. Please try again.",
    };
  }

  if (!data) {
    return { ok: false, error: "Staff member was not found." };
  }

  return {
    ok: true,
    member: {
      userId: data.user_id,
      fullName: data.full_name,
      role: data.role,
      team: data.team,
      isActive: Boolean(data.is_active),
    },
  };
}
