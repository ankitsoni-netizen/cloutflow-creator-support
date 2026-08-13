export const INVITE_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "executive", label: "Executive" },
] as const;

export type InviteRoleValue = (typeof INVITE_ROLES)[number]["value"];

/** @deprecated Use INVITE_ROLES — kept as value list for validation. */
export const PREPARED_ROLES = INVITE_ROLES.map((role) => role.value);

export function isPreparedRole(value: string): value is InviteRoleValue {
  return INVITE_ROLES.some((role) => role.value === value);
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role?.trim().toLowerCase() === "admin";
}

export function inviteRoleLabel(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  const match = INVITE_ROLES.find((role) => role.value === trimmed);
  if (match) return match.label;
  if (!value?.trim()) return "Not provided";
  return value.trim();
}
