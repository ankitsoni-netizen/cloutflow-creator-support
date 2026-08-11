import AccessDenied from "@/components/AccessDenied";
import AuthDiagnosticError from "@/components/AuthDiagnosticError";
import CreatorSupportApp from "@/components/CreatorSupportApp";
import { requireActiveStaff } from "@/lib/auth";

export default async function Home() {
  const result = await requireActiveStaff();

  if (result.status === "error") {
    return <AuthDiagnosticError message={result.message} />;
  }

  if (result.status === "denied") {
    return <AccessDenied />;
  }

  return <CreatorSupportApp />;
}
