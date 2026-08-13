"use server";

import {
  updateStaff,
  type UpdateStaffInput,
  type UpdateStaffResult,
} from "@/lib/team/update-staff";

export async function updateStaffAction(
  input: UpdateStaffInput,
): Promise<UpdateStaffResult> {
  return updateStaff(input);
}
