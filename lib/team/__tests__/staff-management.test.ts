import { describe, expect, it, vi } from "vitest";
import { setStaffActive } from "@/lib/team/set-staff-active";
import { updateStaff } from "@/lib/team/update-staff";
import type { User } from "@supabase/supabase-js";

function adminContext(userId = "admin-user-1") {
  return {
    ok: true as const,
    user: { id: userId } as User,
    profile: {
      user_id: userId,
      full_name: "Admin User",
      role: "admin",
      team: "Creator Support",
      is_active: true,
    },
    supabase: {} as never,
  };
}

function mockUpdateClient(options?: {
  data?: {
    user_id: string;
    full_name: string;
    role: string;
    team: string | null;
    is_active: boolean;
  } | null;
  error?: { message: string; code?: string } | null;
}) {
  const maybeSingle = vi.fn(async () => ({
    data: options?.data ?? null,
    error: options?.error ?? null,
  }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));

  return { client: { from }, update, eq, select, maybeSingle };
}

describe("updateStaff", () => {
  it("rejects non-admins", async () => {
    const result = await updateStaff(
      { userId: "u1", name: "A", role: "executive" },
      {
        getStaffContext: async () => ({
          ...adminContext(),
          profile: { ...adminContext().profile, role: "executive" },
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Only Admins/i);
    }
  });

  it("updates name and role", async () => {
    const { client } = mockUpdateClient({
      data: {
        user_id: "u1",
        full_name: "Riya Sharma",
        role: "executive",
        team: "Creator Support",
        is_active: true,
      },
    });

    const result = await updateStaff(
      { userId: "u1", name: "Riya Sharma", role: "executive" },
      {
        getStaffContext: async () => adminContext(),
        createAdmin: () => client as never,
      },
    );

    expect(result).toEqual({
      ok: true,
      member: {
        userId: "u1",
        fullName: "Riya Sharma",
        role: "executive",
        team: "Creator Support",
        isActive: true,
      },
    });
  });
});

describe("setStaffActive", () => {
  it("blocks self-disable", async () => {
    const result = await setStaffActive(
      { userId: "admin-user-1", isActive: false },
      { getStaffContext: async () => adminContext("admin-user-1") },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot disable your own/i);
    }
  });

  it("disables another user", async () => {
    const { client } = mockUpdateClient({
      data: {
        user_id: "u2",
        full_name: "Other User",
        role: "executive",
        team: "Creator Support",
        is_active: false,
      },
    });

    const result = await setStaffActive(
      { userId: "u2", isActive: false },
      {
        getStaffContext: async () => adminContext(),
        createAdmin: () => client as never,
      },
    );

    expect(result).toEqual({
      ok: true,
      member: {
        userId: "u2",
        fullName: "Other User",
        role: "executive",
        team: "Creator Support",
        isActive: false,
      },
    });
  });
});
