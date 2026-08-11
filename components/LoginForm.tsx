"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError("Incorrect email or password. Please try again.");
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-5 h-12 w-48 overflow-hidden rounded-md bg-sidebar">
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
            Creator Support Desk
          </h1>
          <p className="mt-2 text-sm text-muted">
            Sign in to manage creator support tickets
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="you@cloutflow.com"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-foreground">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="Enter your password"
            />
          </label>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
