import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type StaffProfile = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  team: string | null;
  is_active: boolean;
};

export type StaffAuthResult =
  | { status: "allowed"; user: User; profile: StaffProfile }
  | { status: "denied"; user: User; profile: null }
  | { status: "error"; user: User; message: string };

export async function requireActiveStaff(): Promise<StaffAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("staff_profiles")
    .select("user_id, full_name, role, team, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (profileError) {
    console.error("staff_profiles lookup failed", {
      code: profileError.code,
      message: profileError.message,
    });

    return {
      status: "error",
      user,
      message:
        "Unable to verify staff access right now. Please try again or contact an administrator.",
    };
  }

  if (!profile) {
    return { status: "denied", user, profile: null };
  }

  return {
    status: "allowed",
    user,
    profile: profile as StaffProfile,
  };
}
