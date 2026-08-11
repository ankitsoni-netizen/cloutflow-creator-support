"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthDiagnosticErrorProps {
  message: string;
}

export default function AuthDiagnosticError({
  message,
}: AuthDiagnosticErrorProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="relative mx-auto mb-5 h-12 w-48 overflow-hidden rounded-md bg-sidebar">
          <Image
            src="/cloutflow-logo.png"
            alt="Cloutflow"
            fill
            priority
            className="object-contain px-3"
            sizes="192px"
          />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Staff verification error
        </h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-800"
        >
          Diagnostic: staff profile lookup failed. Authentication succeeded, but
          Creator Support could not confirm your active staff record.
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={loading}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}
