"use server";

import {
  setStaffActive,
  type SetStaffActiveInput,
  type SetStaffActiveResult,
} from "@/lib/team/set-staff-active";

export async function setStaffActiveAction(
  input: SetStaffActiveInput,
): Promise<SetStaffActiveResult> {
  return setStaffActive(input);
}
