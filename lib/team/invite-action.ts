"use server";

import {
  inviteStaff,
  type InviteStaffInput,
  type InviteStaffResult,
} from "@/lib/team/invite-staff";

export async function inviteStaffAction(
  input: InviteStaffInput,
): Promise<InviteStaffResult> {
  return inviteStaff(input);
}
