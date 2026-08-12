import WebsiteEnquiryForm from "@/components/WebsiteEnquiryForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Creator Support | Cloutflow",
  description:
    "Submit a creator support request to Cloutflow. Get a ticket code and acknowledgement by email.",
};

export default function HelpPage() {
  return (
    <div className="relative min-h-full overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at top left, rgba(6,182,212,0.12), transparent 35%), radial-gradient(circle at top right, rgba(124,58,237,0.14), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.4), transparent 28%)",
        }}
      />

      <main className="relative mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 text-center sm:mb-10">
          <img
            src="/cloutflow-brand-logo.png"
            alt="Cloutflow"
            width={220}
            height={41}
            className="mx-auto mb-5 h-11 w-auto max-w-[220px] object-contain object-center"
          />
          <p className="text-[11px] font-semibold tracking-[0.16em] text-muted uppercase">
            Creator Care
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Cloutflow
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Tell us what went wrong with your campaign. We will open a support
            ticket and email you an acknowledgement with your ticket code.
          </p>
        </header>

        <WebsiteEnquiryForm />
      </main>
    </div>
  );
}
