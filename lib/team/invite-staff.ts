import { randomBytes } from "node:crypto";
import { isBrevoConfigured } from "@/lib/email/env-check";
import {
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "@/lib/email/html";
import { sendTransactionalEmail } from "@/lib/email/send";
import { buildStaffWelcomeEmail } from "@/lib/email/templates/staff-welcome";
import { safeEmailErrorMessage } from "@/lib/email/ticket-mail";
import type {
  SendTransactionalEmailInput,
  SendTransactionalEmailResult,
} from "@/lib/email/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getActiveStaffContext,
  type ActionStaffContext,
} from "@/lib/tickets/auth-action";
import { logSupabaseError } from "@/lib/tickets/errors";
import type { StaffDirectoryMember } from "@/lib/types";
import { isAdminRole, isPreparedRole } from "@/lib/team/roles";
import { resolveAppOrigin } from "@/lib/team/site-url";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InviteStaffInput = {
  name: string;
  email: string;
  role: string;
};

export type InviteStaffResult =
  | { ok: true; member: StaffDirectoryMember }
  | { ok: false; error: string };

export type InviteStaffDeps = {
  getStaffContext?: () => Promise<ActionStaffContext>;
  createAdmin?: () => SupabaseClient;
  isEmailConfigured?: () => boolean;
  sendEmail?: (
    input: SendTransactionalEmailInput,
  ) => Promise<SendTransactionalEmailResult>;
  getAppOrigin?: () => string;
  generatePassword?: () => string;
};

const DEFAULT_TEAM = "Creator Support";

export function generateInvitePassword(): string {
  return randomBytes(18).toString("base64url");
}

function mapAuthCreateError(message: string): string {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("already been registered") ||
    lowered.includes("already registered") ||
    lowered.includes("user already exists") ||
    lowered.includes("duplicate") ||
    lowered.includes("email_exists")
  ) {
    return "A user with this email already exists.";
  }
  return "Unable to create the user account. Please try again.";
}

/**
 * Admin-only staff invite: create Auth user with a generated password,
 * insert staff_profiles, and email credentials via Brevo.
 * The password is never returned to the client.
 */
export async function inviteStaff(
  input: InviteStaffInput,
  deps: InviteStaffDeps = {},
): Promise<InviteStaffResult> {
  const getStaffContext = deps.getStaffContext ?? getActiveStaffContext;
  const createAdmin = deps.createAdmin ?? createAdminClient;
  const isEmailConfigured = deps.isEmailConfigured ?? isBrevoConfigured;
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;
  const getAppOrigin = deps.getAppOrigin ?? (() => resolveAppOrigin());
  const generatePassword = deps.generatePassword ?? generateInvitePassword;

  const context = await getStaffContext();
  if (!context.ok) {
    return { ok: false, error: context.error };
  }
  if (!isAdminRole(context.profile.role)) {
    return {
      ok: false,
      error: "Only Admins can invite new users.",
    };
  }

  const fullName = input.name.trim();
  if (!fullName) {
    return { ok: false, error: "Name is required." };
  }

  const email = input.email.trim().toLowerCase();
  if (!isValidEmailAddress(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const role = input.role.trim().toLowerCase();
  if (!isPreparedRole(role)) {
    return { ok: false, error: "Select a valid role." };
  }

  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: "Email is not configured on the server. Invitation cannot be sent.",
    };
  }

  let admin: SupabaseClient;
  try {
    admin = createAdmin();
  } catch {
    return {
      ok: false,
      error: "Staff invite is temporarily unavailable. Please try again later.",
    };
  }

  const password = generatePassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    },
  );

  if (createError || !created.user?.id) {
    const message = createError?.message ?? "User create returned no user.";
    console.error("staff invite auth createUser failed", {
      message: createError?.message,
      status: createError?.status,
    });
    return { ok: false, error: mapAuthCreateError(message) };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: userId,
    full_name: fullName,
    role,
    team: DEFAULT_TEAM,
    is_active: true,
  });

  if (profileError) {
    logSupabaseError("staff invite staff_profiles insert failed", profileError);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("staff invite cleanup deleteUser failed", {
        message: deleteError.message,
      });
    }
    if (profileError.code === "23514") {
      return {
        ok: false,
        error: "That role is not allowed. Choose Admin or Executive.",
      };
    }
    return {
      ok: false,
      error: "Unable to create the staff profile. Please try again.",
    };
  }

  const origin = getAppOrigin().replace(/\/$/, "");
  const loginUrl = `${origin}/login`;
  const logoUrl = `${origin}/cloutflow-logo.png`;
  const content = buildStaffWelcomeEmail({
    fullName,
    email,
    password,
    loginUrl,
    logoUrl,
  });

  try {
    await sendEmail({
      toEmail: email,
      toName: sanitizeEmailHeaderValue(fullName),
      subject: sanitizeEmailHeaderValue(content.subject),
      html: content.html,
      text: content.text,
      metadata: {
        purpose: "staff-welcome",
        "invited-by": context.user.id,
      },
    });
  } catch (error) {
    console.error("staff invite welcome email failed", {
      userId,
      reason: safeEmailErrorMessage(error),
    });
    return {
      ok: false,
      error:
        "User was created, but the welcome email could not be sent. Ask an Admin to resend credentials or reset the password.",
    };
  }

  return {
    ok: true,
    member: {
      userId,
      fullName,
      role,
      team: DEFAULT_TEAM,
      isActive: true,
    },
  };
}
