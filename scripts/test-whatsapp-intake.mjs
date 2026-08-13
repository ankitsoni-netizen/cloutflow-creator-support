/**
 * Live check: POST a creator_support sample to /api/whatsapp/tickets.
 * Never prints or logs WHATSAPP_INTAKE_API_KEY.
 *
 * Usage:
 *   npm run whatsapp:test -- you@example.com
 */

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnvConfig(projectRoot, true);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function resolveBaseUrl() {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (site) return site;

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) {
    if (/^https?:\/\//i.test(vercel)) return vercel;
    return `https://${vercel}`;
  }

  return "http://localhost:3000";
}

function sanitizeErrorMessage(error) {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "Unexpected request failure.";

  const key = process.env.WHATSAPP_INTAKE_API_KEY;
  if (key && key.length > 0) {
    return raw.split(key).join("[WHATSAPP_INTAKE_API_KEY]");
  }
  return raw;
}

async function main() {
  const recipient = process.argv[2]?.trim();
  if (!recipient) {
    fail(
      "Missing test recipient. Usage: npm run whatsapp:test -- you@example.com",
    );
  }
  if (!EMAIL_PATTERN.test(recipient)) {
    fail("Test recipient must be a valid email address.");
  }

  const apiKey = process.env.WHATSAPP_INTAKE_API_KEY?.trim();
  if (!apiKey) {
    fail("Missing required environment variable: WHATSAPP_INTAKE_API_KEY.");
  }

  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}/api/whatsapp/tickets`;

  const payload = {
    category: "creator_support",
    name: "WhatsApp Intake Test",
    phone: "+919876543210",
    email: recipient,
    socialHandle: "@whatsapp.intake.test",
    platform: "Instagram",
    issueType: "Other",
    campaignName: "WhatsApp Intake Test",
    brandName: "Cloutflow",
    campaignMonth: "August 2026",
    cloutflowPocName: "Support Test",
    cloutflowPocContactNumber: "+919876543210",
    message: "Automated WhatsApp intake test. Safe to close.",
    companyWebsite: "",
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    fail(sanitizeErrorMessage(error));
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  const ticketCode =
    data && typeof data.ticketCode === "string" ? data.ticketCode : "(none)";
  const acknowledgementSent =
    data && typeof data.acknowledgementSent === "boolean"
      ? String(data.acknowledgementSent)
      : "(none)";

  console.log(`HTTP status: ${response.status}`);
  console.log(`ticketCode: ${ticketCode}`);
  console.log(`acknowledgementSent: ${acknowledgementSent}`);

  if (response.status === 201 && data?.success === true && data.ticketCode) {
    console.log("Result: SUCCESS — WhatsApp ticket created.");
    return;
  }

  const publicMessage =
    data && typeof data.message === "string" ? data.message : "Request failed.";
  console.log("Result: FAILURE — WhatsApp ticket was not created.");
  fail(publicMessage);
}

main().catch((error) => {
  fail(sanitizeErrorMessage(error));
});
