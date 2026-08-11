"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AccessDenied() {
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
        <img
          src="/cloutflow-brand-logo.png"
          alt="Cloutflow"
          width={220}
          height={41}
          className="mx-auto mb-5 h-11 w-auto max-w-[220px] object-contain object-center"
        />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Access denied
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your account is not authorized for Creator Support. Contact an
          administrator if you believe this is a mistake.
        </p>
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
