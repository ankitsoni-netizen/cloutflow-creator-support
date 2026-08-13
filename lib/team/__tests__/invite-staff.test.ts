import { describe, expect, it, vi } from "vitest";
import { buildStaffWelcomeEmail } from "@/lib/email/templates/staff-welcome";
import { inviteStaff } from "@/lib/team/invite-staff";
import { isAdminRole, isPreparedRole, PREPARED_ROLES } from "@/lib/team/roles";
import { resolveAppOrigin } from "@/lib/team/site-url";
import type { User } from "@supabase/supabase-js";

function adminContext() {
  return {
    ok: true as const,
    user: { id: "admin-user-1" } as User,
    profile: {
      user_id: "admin-user-1",
      full_name: "Admin User",
      role: "admin",
      team: "Creator Support",
      is_active: true,
    },
    supabase: {} as never,
  };
}

function mockAdminClient(options?: {
  createError?: { message: string; status?: number } | null;
  profileError?: { message: string; code?: string } | null;
  deleteError?: { message: string } | null;
}) {
  const createUser = vi.fn(async () => {
    if (options?.createError) {
      return { data: { user: null }, error: options.createError };
    }
    return {
      data: { user: { id: "new-user-1" } },
      error: null,
    };
  });
  const deleteUser = vi.fn(async () => ({
    data: null,
    error: options?.deleteError ?? null,
  }));
  const insert = vi.fn(async () => ({
    data: null,
    error: options?.profileError ?? null,
  }));

  return {
    client: {
      auth: {
        admin: {
          createUser,
          deleteUser,
        },
      },
      from: vi.fn(() => ({ insert })),
    },
    createUser,
    deleteUser,
    insert,
  };
}

describe("team roles", () => {
  it("recognizes admin and executive only", () => {
    expect(PREPARED_ROLES).toEqual(["admin", "executive"]);
    expect(isPreparedRole("admin")).toBe(true);
    expect(isPreparedRole("executive")).toBe(true);
    expect(isPreparedRole("Admin")).toBe(false);
    expect(isPreparedRole("CRM Executive")).toBe(false);
    expect(isAdminRole("Admin")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("executive")).toBe(false);
  });
});

describe("resolveAppOrigin", () => {
  it("prefers NEXT_PUBLIC_SITE_URL then VERCEL_URL", () => {
    expect(
      resolveAppOrigin({
        NEXT_PUBLIC_SITE_URL: "https://crm.example.com/",
      }),
    ).toBe("https://crm.example.com");
    expect(
      resolveAppOrigin({
        VERCEL_URL: "cloutflow-creator-support.vercel.app",
      }),
    ).toBe("https://cloutflow-creator-support.vercel.app");
    expect(resolveAppOrigin({})).toBe("http://localhost:3000");
  });
});

describe("staff welcome email", () => {
  it("personalizes greeting and includes logo, email, and password", () => {
    const email = buildStaffWelcomeEmail({
      fullName: `Riya <b>Sharma</b>`,
      email: `riya+"@example.com`,
      password: `p@ss"word<script>`,
      loginUrl: "https://crm.example.com/login",
      logoUrl: "https://crm.example.com/cloutflow-logo.png",
    });

    expect(email.subject).toBe("Welcome to Cloutflow CRM");
    expect(email.html).toContain("Hi Riya &lt;b&gt;Sharma&lt;/b&gt;,");
    expect(email.html).toContain(
      'src="https://crm.example.com/cloutflow-logo.png"',
    );
    expect(email.html).toContain("riya+&quot;@example.com");
    expect(email.html).toContain("p@ss&quot;word&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("Hi Riya <b>Sharma</b>,");
    expect(email.text).toContain("Email: riya+\"@example.com");
    expect(email.text).toContain('Password: p@ss"word<script>');
    expect(email.text).toContain("https://crm.example.com/login");
  });
});

describe("inviteStaff gates", () => {
  it("rejects non-Admin callers", async () => {
    const sendEmail = vi.fn();
    const result = await inviteStaff(
      {
        name: "Riya Sharma",
        email: "riya@example.com",
        role: "executive",
      },
      {
        getStaffContext: async () => ({
          ...adminContext(),
          profile: {
            ...adminContext().profile,
            role: "Supervisor",
          },
        }),
        isEmailConfigured: () => true,
        sendEmail,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "Only Admins can invite new users.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects missing name", async () => {
    const result = await inviteStaff(
      { name: "   ", email: "riya@example.com", role: "executive" },
      {
        getStaffContext: async () => adminContext(),
        isEmailConfigured: () => true,
        sendEmail: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: false, error: "Name is required." });
  });

  it("rejects invalid email", async () => {
    const result = await inviteStaff(
      { name: "Riya", email: "not-an-email", role: "executive" },
      {
        getStaffContext: async () => adminContext(),
        isEmailConfigured: () => true,
        sendEmail: vi.fn(),
      },
    );
    expect(result).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
  });

  it("rejects invalid role", async () => {
    const result = await inviteStaff(
      { name: "Riya", email: "riya@example.com", role: "supervisor" },
      {
        getStaffContext: async () => adminContext(),
        isEmailConfigured: () => true,
        sendEmail: vi.fn(),
      },
    );
    expect(result).toEqual({ ok: false, error: "Select a valid role." });
  });

  it("creates user, profile, and sends welcome email without returning password", async () => {
    const admin = mockAdminClient();
    const sendEmail = vi.fn(
      async (_input: {
        toEmail: string;
        toName?: string;
        subject: string;
        html: string;
        text: string;
      }) => ({
        messageId: "msg-1",
        accepted: ["riya@example.com"],
        rejected: [],
        status: "accepted_by_brevo" as const,
      }),
    );

    const result = await inviteStaff(
      {
        name: " Riya Sharma ",
        email: " Riya@Example.com ",
        role: "executive",
      },
      {
        getStaffContext: async () => adminContext(),
        createAdmin: () => admin.client as never,
        isEmailConfigured: () => true,
        sendEmail,
        getAppOrigin: () => "https://crm.example.com",
        generatePassword: () => "TempPass_abc123XYZ",
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member).toEqual({
        userId: "new-user-1",
        fullName: "Riya Sharma",
        role: "executive",
        team: "Creator Support",
        isActive: true,
      });
      expect(JSON.stringify(result)).not.toContain("TempPass_abc123XYZ");
    }

    expect(admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "riya@example.com",
        password: "TempPass_abc123XYZ",
        email_confirm: true,
        user_metadata: { full_name: "Riya Sharma" },
      }),
    );
    expect(admin.insert).toHaveBeenCalledWith({
      user_id: "new-user-1",
      full_name: "Riya Sharma",
      role: "executive",
      team: "Creator Support",
      is_active: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "riya@example.com",
        toName: "Riya Sharma",
        subject: "Welcome to Cloutflow CRM",
      }),
    );
    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent?.html).toContain("Hi Riya Sharma,");
    expect(sent?.html).toContain("TempPass_abc123XYZ");
    expect(sent?.html).toContain("https://crm.example.com/cloutflow-logo.png");
  });

  it("maps duplicate auth users to a safe error", async () => {
    const admin = mockAdminClient({
      createError: { message: "User already registered", status: 422 },
    });
    const result = await inviteStaff(
      {
        name: "Riya Sharma",
        email: "riya@example.com",
        role: "executive",
      },
      {
        getStaffContext: async () => adminContext(),
        createAdmin: () => admin.client as never,
        isEmailConfigured: () => true,
        sendEmail: vi.fn(),
        generatePassword: () => "TempPass_abc123XYZ",
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "A user with this email already exists.",
    });
  });
});
