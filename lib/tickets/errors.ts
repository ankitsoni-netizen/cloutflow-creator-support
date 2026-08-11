type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function logSupabaseError(context: string, error: SupabaseLikeError) {
  console.error(
    [
      context,
      `code=${error.code ?? "none"}`,
      `message=${error.message ?? "none"}`,
      `details=${error.details ?? "none"}`,
      `hint=${error.hint ?? "none"}`,
    ].join(" | "),
  );
}

export function toSafeTicketErrorMessage(error: SupabaseLikeError): string {
  const message = error.message?.trim() ?? "";
  const details = error.details?.trim() ?? "";
  const hint = error.hint?.trim() ?? "";
  const combined = `${message} ${details} ${hint}`;

  if (/jwt|apikey|api key|bearer\s|secret key|service.role/i.test(combined)) {
    return "Unable to complete the ticket request. Please try again.";
  }

  if (/row-level security|rls/i.test(combined)) {
    return "You do not have permission to perform this action.";
  }

  if (/campaign_month/i.test(combined)) {
    return "Campaign month could not be saved. Use a month and year like August 2026.";
  }

  if (/invalid input value for enum/i.test(combined)) {
    return hint || details || message || "One or more ticket fields are invalid.";
  }

  if (error.code === "PGRST116") {
    return "Ticket may have been created, but it could not be loaded back. Refresh the inbox and try again.";
  }

  if (message) {
    if (details && hint) return `${message} (${details}). ${hint}`;
    if (details) return `${message} (${details})`;
    if (hint) return `${message}. ${hint}`;
    return message;
  }

  return "Unable to complete the ticket request. Please try again.";
}
