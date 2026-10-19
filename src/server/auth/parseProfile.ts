/** Rampset's account data, validated whenever it's created or changed.
 * Pure, so the integration suite runs the same check on the real Durable
 * Object. */

import { AuthInputError } from "durable-auth/server";
import { getTemplate } from "@/lib/programTemplates";

/** What an account keeps beside its name: how this lifter trains and sees the app. */
export interface Profile {
  unit: "kg" | "lb";
  templateId: string;
  accent: "blue" | "green";
  theme: "dark" | "light";
  [key: string]: unknown;
}

export function parseProfile(v: unknown): Profile {
  const p = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof Profile, unknown>>;
  if (p.unit !== "kg" && p.unit !== "lb") throw new AuthInputError("Unit must be kg or lb");
  if (typeof p.templateId !== "string" || !getTemplate(p.templateId)) throw new AuthInputError("Unknown program");
  return {
    unit: p.unit,
    templateId: p.templateId,
    accent: p.accent === "green" ? "green" : "blue",
    theme: p.theme === "light" ? "light" : "dark",
  };
}
