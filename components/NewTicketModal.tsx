"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EXECUTIVES, ISSUE_TYPES } from "@/lib/ticket-constants";
import type { NewTicketFormData, Platform } from "@/lib/types";

const fieldInputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

type FormErrors = Partial<Record<keyof NewTicketFormData, string>>;

type CreateTicketResult = { ok: true } | { ok: false; message: string };

interface NewTicketModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: NewTicketFormData) => Promise<CreateTicketResult>;
  defaultSendAcknowledgementEmail?: boolean;
}

function validate(form: NewTicketFormData): FormErrors {
  const errors: FormErrors = {};

  if (!form.issueType) errors.issueType = "Issue type is required.";
  if (!form.creatorName.trim()) errors.creatorName = "Creator name is required.";
  if (!form.phone.trim()) errors.phone = "Phone number is required.";
  if (!form.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!form.socialHandle.trim()) {
    errors.socialHandle = "Social media handle is required.";
  }
  if (!form.campaignName.trim()) {
    errors.campaignName = "Campaign name is required.";
  }
  if (!form.brand.trim()) errors.brand = "Brand name is required.";
  if (!form.campaignMonth.trim()) {
    errors.campaignMonth = "Campaign month is required.";
  }
  if (!form.cloutflowPoc.trim()) {
    errors.cloutflowPoc = "Cloutflow POC is required.";
  }
  if (!form.cloutflowPocContactNumber.trim()) {
    errors.cloutflowPocContactNumber =
      "Cloutflow POC contact number is required.";
  }
  if (!form.issueDescription.trim()) {
    errors.issueDescription = "Issue description is required.";
  }
  if (!form.assignedExecutive) {
    errors.assignedExecutive = "Assigned executive is required.";
  }

  return errors;
}

export default function NewTicketModal({
  open,
  onClose,
  onCreate,
  defaultSendAcknowledgementEmail = true,
}: NewTicketModalProps) {
  if (!open) return null;

  return (
    <NewTicketModalForm
      onClose={onClose}
      onCreate={onCreate}
      defaultSendAcknowledgementEmail={defaultSendAcknowledgementEmail}
    />
  );
}

function NewTicketModalForm({
  onClose,
  onCreate,
  defaultSendAcknowledgementEmail,
}: {
  onClose: () => void;
  onCreate: (data: NewTicketFormData) => Promise<CreateTicketResult>;
  defaultSendAcknowledgementEmail: boolean;
}) {
  const [form, setForm] = useState<NewTicketFormData>({
    source: "Phone Call",
    issueType: "",
    creatorName: "",
    phone: "",
    email: "",
    socialHandle: "",
    platform: "Instagram",
    campaignName: "",
    brand: "",
    campaignMonth: "",
    cloutflowPoc: "",
    cloutflowPocContactNumber: "",
    issueDescription: "",
    internalCallNotes: "",
    assignedExecutive: "",
    sendAcknowledgementEmail: defaultSendAcknowledgementEmail,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  function updateField<K extends keyof NewTicketFormData>(
    key: K,
    value: NewTicketFormData[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSubmitError(null);
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validate(form);
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    const result = await onCreate(form);
    if (!result.ok) {
      setSubmitError(result.message);
      setSubmitting(false);
      return;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8 sm:items-center">
      <button
        type="button"
        aria-label="Close modal overlay"
        className="absolute inset-0"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        className="relative z-10 w-full max-w-3xl rounded-xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            id="new-ticket-title"
            className="text-lg font-semibold text-foreground"
          >
            Raise New Creator Ticket
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
            <Field label="Source">
              <input
                value="Phone Call"
                readOnly
                className={`${fieldInputClass} bg-surface-muted text-muted`}
              />
            </Field>

            <Field label="Issue Type" required error={errors.issueType}>
              <select
                value={form.issueType}
                onChange={(e) => updateField("issueType", e.target.value)}
                className={fieldInputClass}
              >
                <option value="">Select issue type</option>
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Creator Name" required error={errors.creatorName}>
              <input
                value={form.creatorName}
                onChange={(e) => updateField("creatorName", e.target.value)}
                className={fieldInputClass}
                placeholder="Full name"
              />
            </Field>

            <Field label="Phone Number" required error={errors.phone}>
              <input
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                className={fieldInputClass}
                placeholder="+91 XXXXX XXXXX"
              />
            </Field>

            <Field label="Email Address" required error={errors.email}>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                className={fieldInputClass}
                placeholder="creator@email.com"
              />
            </Field>

            <Field
              label="Social Media Handle"
              required
              error={errors.socialHandle}
            >
              <input
                value={form.socialHandle}
                onChange={(e) => updateField("socialHandle", e.target.value)}
                className={fieldInputClass}
                placeholder="@handle"
              />
            </Field>

            <Field label="Platform" required>
              <select
                value={form.platform}
                onChange={(e) =>
                  updateField("platform", e.target.value as Platform)
                }
                className={fieldInputClass}
              >
                <option value="Instagram">Instagram</option>
                <option value="YouTube">YouTube</option>
              </select>
            </Field>

            <Field label="Campaign Name" required error={errors.campaignName}>
              <input
                value={form.campaignName}
                onChange={(e) => updateField("campaignName", e.target.value)}
                className={fieldInputClass}
                placeholder="Campaign name"
              />
            </Field>

            <Field label="Brand Name" required error={errors.brand}>
              <input
                value={form.brand}
                onChange={(e) => updateField("brand", e.target.value)}
                className={fieldInputClass}
                placeholder="Brand name"
              />
            </Field>

            <Field
              label="Campaign Month"
              required
              error={errors.campaignMonth}
            >
              <input
                value={form.campaignMonth}
                onChange={(e) => updateField("campaignMonth", e.target.value)}
                className={fieldInputClass}
                placeholder="e.g. August 2026"
              />
            </Field>

            <Field label="Cloutflow POC" required error={errors.cloutflowPoc}>
              <input
                value={form.cloutflowPoc}
                onChange={(e) => updateField("cloutflowPoc", e.target.value)}
                className={fieldInputClass}
                placeholder="POC name"
              />
            </Field>

            <Field
              label="Cloutflow POC Contact Number"
              required
              error={errors.cloutflowPocContactNumber}
            >
              <input
                value={form.cloutflowPocContactNumber}
                onChange={(e) =>
                  updateField("cloutflowPocContactNumber", e.target.value)
                }
                className={fieldInputClass}
                placeholder="+91 XXXXX XXXXX"
              />
            </Field>

            <Field
              label="Assigned Executive"
              required
              error={errors.assignedExecutive}
            >
              <select
                value={form.assignedExecutive}
                onChange={(e) =>
                  updateField("assignedExecutive", e.target.value)
                }
                className={fieldInputClass}
              >
                <option value="">Select executive</option>
                {EXECUTIVES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field
                label="Issue Description"
                required
                error={errors.issueDescription}
              >
                <textarea
                  value={form.issueDescription}
                  onChange={(e) =>
                    updateField("issueDescription", e.target.value)
                  }
                  className={`${fieldInputClass} min-h-24 resize-y`}
                  placeholder="Describe the creator issue"
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Internal Call Notes">
                <textarea
                  value={form.internalCallNotes}
                  onChange={(e) =>
                    updateField("internalCallNotes", e.target.value)
                  }
                  className={`${fieldInputClass} min-h-20 resize-y`}
                  placeholder="Optional notes from the call"
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <label className="flex items-start gap-3 rounded-md border border-border bg-surface-muted px-3 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.sendAcknowledgementEmail}
                  onChange={(e) =>
                    updateField("sendAcknowledgementEmail", e.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  Send acknowledgement email
                  <span className="mt-0.5 block text-xs text-muted">
                    Notify the creator that their ticket has been logged.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {submitError ? (
            <div className="px-5 pb-2">
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {submitError}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Creating..." : "Create Ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-foreground">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : null}
    </label>
  );
}
