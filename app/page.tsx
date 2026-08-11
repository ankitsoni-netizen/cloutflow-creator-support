import AccessDenied from "@/components/AccessDenied";
import AuthDiagnosticError from "@/components/AuthDiagnosticError";
import CreatorSupportApp from "@/components/CreatorSupportApp";
import { requireActiveStaff } from "@/lib/auth";
import { fetchTicketsForStaff } from "@/lib/tickets/server";

export default async function Home() {
  const result = await requireActiveStaff();

  if (result.status === "error") {
    return <AuthDiagnosticError message={result.message} />;
  }

  if (result.status === "denied") {
    return <AccessDenied />;
  }

  const ticketsResult = await fetchTicketsForStaff();
  const initialTickets =
    "tickets" in ticketsResult ? ticketsResult.tickets : [];
  const initialLoadError =
    "error" in ticketsResult ? ticketsResult.error : null;

  return (
    <CreatorSupportApp
      staffProfile={result.profile}
      initialTickets={initialTickets}
      initialLoadError={initialLoadError}
    />
  );
}
