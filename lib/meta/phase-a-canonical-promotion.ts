import { IDENTITY_AMBIGUOUS } from "@/lib/meta/conversation-identity";
import type { ConversationIdentity } from "@/lib/meta/conversation-identity";
import { isIdentitySchemaPhaseC } from "@/lib/meta/identity-schema-phase";
import type {
  InstagramConversationRow,
  InstagramIngestStore,
} from "@/lib/meta/instagram-store";

export async function promotePhaseACanonicalIdentityIfEligible(
  store: InstagramIngestStore,
  identity: ConversationIdentity,
): Promise<
  | { outcome: "ok"; row: InstagramConversationRow }
  | { outcome: "not_found" }
  | { outcome: "failed"; errorCode: string }
> {
  if (!isIdentitySchemaPhaseC()) {
    return { outcome: "not_found" };
  }
  if (typeof store.promoteEligiblePhaseACanonicalIdentity !== "function") {
    return { outcome: "not_found" };
  }
  const promoted = await store.promoteEligiblePhaseACanonicalIdentity(identity);
  if (
    promoted.outcome === "promoted" ||
    promoted.outcome === "already_promoted"
  ) {
    return { outcome: "ok", row: promoted.row };
  }
  if (promoted.outcome === "not_found") {
    return { outcome: "not_found" };
  }
  return {
    outcome: "failed",
    errorCode: promoted.errorCode || IDENTITY_AMBIGUOUS,
  };
}
