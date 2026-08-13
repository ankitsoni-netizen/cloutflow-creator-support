import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveStaffContext,
  type ActionStaffContext,
} from "@/lib/tickets/auth-action";
import { logSupabaseError } from "@/lib/tickets/errors";
import type { StaffDirectoryMember } from "@/lib/types";
import { isAdminRole, isPreparedRole } from "@/lib/team/roles";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UpdateStaffInput = {
  userId: string;
  name: string;
  role: string;
};

export type UpdateStaffResult =
  | { ok: true; member: StaffDirectoryMember }
  | { ok: false; error: string };

export type UpdateStaffDeps = {
  getStaffContext?: () => Promise<ActionStaffContext>;
  createAdmin?: () => SupabaseClient;
};

/**
 * Admin-only: update a staff member's full_name and role.
 */
export async function updateStaff(
  input: UpdateStaffInput,
  deps: UpdateStaffDeps = {},
): Promise<UpdateStaffResult> {
  const getStaffContext = deps.getStaffContext ?? getActiveStaffContext;
  const createAdmin = deps.createAdmin ?? createAdminClient;

  const context = await getStaffContext();
  if (!context.ok) {
    return { ok: false, error: context.error };
  }
  if (!isAdminRole(context.profile.role)) {
    return {
      ok: false,
      error: "Only Admins can edit team members.",
    };
  }

  const userId = input.userId.trim();
  if (!userId) {
    return { ok: false, error: "Staff member is required." };
  }

  const fullName = input.name.trim();
  if (!fullName) {
    return { ok: false, error: "Name is required." };
  }

  const role = input.role.trim().toLowerCase();
  if (!isPreparedRole(role)) {
    return { ok: false, error: "Select a valid role." };
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
    .update({ full_name: fullName, role })
    .eq("user_id", userId)
    .select("user_id, full_name, role, team, is_active")
    .maybeSingle();

  if (error) {
    logSupabaseError("staff_profiles update failed", error);
    if (error.code === "23514") {
      return {
        ok: false,
        error: "That role is not allowed. Choose Admin or Executive.",
      };
    }
    return {
      ok: false,
      error: "Unable to update the staff profile. Please try again.",
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
