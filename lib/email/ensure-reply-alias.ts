import { createAdminClient } from "@/lib/supabase/admin";
import { formatReplyAliasAddress } from "@/lib/email/reply-alias";

const ENSURE_ALIAS_RPC = "ensure_ticket_email_reply_alias";

export async function ensureTicketReplyToAddress(
  ticketId: string,
): Promise<string | null> {
  if (!ticketId.trim()) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc(ENSURE_ALIAS_RPC, {
      p_ticket_id: ticketId,
    });
    if (error) return null;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (data && typeof data === "object" && "local_part" in data) {
      const local = String((data as { local_part?: string }).local_part ?? "");
      return local ? formatReplyAliasAddress(local) : null;
    }
    return null;
  } catch {
    return null;
  }
}
