import { z } from "zod";
import { SUPPORTED_LOCALES, isValidTimeZone } from "./locales";
import { STORAGE_MODES } from "./storage";

const email = z.string().trim().toLowerCase().max(255).pipe(z.email("Enter a valid email address"));

/** Length over complexity rules, following NIST SP 800-63B. */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Use at most 200 characters");

const timezone = z.string().max(64).refine(isValidTimeZone, "Unknown timezone");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email,
  password: passwordSchema,
  workspaceName: z.string().trim().min(2, "Enter a workspace name").max(80),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: timezone.optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  locale: z.enum(SUPPORTED_LOCALES),
  timezone,
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const storageModeSchema = z.object({
  mode: z.enum(STORAGE_MODES),
});

export const settingValueSchema = z.object({
  value: z.unknown(),
});

/** The platform owner pins (or releases) one tenant's storage mode. */
export const tenantStorageOverrideSchema = z.object({
  mode: z.enum(STORAGE_MODES).nullable(),
});
