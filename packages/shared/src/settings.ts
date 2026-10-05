import { STORAGE_MODES } from "./storage";

/**
 * The global configuration registry.
 *
 * Every configurable behaviour is declared here once. Values are resolved in
 * layers, most specific first:
 *
 *   1. forced    the platform owner pinned a value for one tenant (locked)
 *   2. tenant    the tenant's admin chose a value (only if `tenantEditable`)
 *   3. platform  the platform owner set the platform-wide value
 *   4. default   the built-in default below
 *
 * Adding a new setting means adding one entry here; storage, the API and the
 * admin screens pick it up from this registry.
 */
export type SettingCategory = "storage" | "security";

interface BaseDefinition {
  category: SettingCategory;
  /** Tenant admins may choose their own value, within the platform's rules. */
  tenantEditable: boolean;
}

type Definition =
  | (BaseDefinition & { type: "boolean"; default: boolean })
  | (BaseDefinition & { type: "number"; default: number; min: number; max: number })
  | (BaseDefinition & { type: "enum"; default: string; options: readonly string[] })
  | (BaseDefinition & { type: "enum_list"; default: readonly string[]; options: readonly string[] });

export const SETTING_DEFINITIONS = {
  /** Where new backups are written. The platform value is the default for every tenant. */
  "storage.mode": {
    category: "storage",
    type: "enum",
    options: STORAGE_MODES,
    default: "local",
    tenantEditable: true,
  },
  /** Which storage modes tenants are allowed to choose. */
  "storage.allowed_modes": {
    category: "storage",
    type: "enum_list",
    options: STORAGE_MODES,
    default: STORAGE_MODES,
    tenantEditable: false,
  },
  /** How long a download link stays valid. */
  "storage.download_url_ttl_seconds": {
    category: "storage",
    type: "number",
    min: 60,
    max: 3600,
    default: 300,
    tenantEditable: true,
  },
  /** Whether new people can create an account and workspace themselves. */
  "signup.enabled": {
    category: "security",
    type: "boolean",
    default: true,
    tenantEditable: false,
  },
} as const satisfies Record<string, Definition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

type ValueOf<D> = D extends { type: "boolean" }
  ? boolean
  : D extends { type: "number" }
    ? number
    : D extends { type: "enum"; options: readonly (infer O)[] }
      ? O
      : D extends { type: "enum_list"; options: readonly (infer O)[] }
        ? O[]
        : never;

export type SettingValues = { [K in SettingKey]: ValueOf<(typeof SETTING_DEFINITIONS)[K]> };

export type SettingSource = "default" | "platform" | "tenant" | "forced";

/** Plain description of a setting, for rendering generic admin forms. */
export interface SettingDescriptor {
  key: SettingKey;
  category: SettingCategory;
  type: Definition["type"];
  default: unknown;
  options?: readonly string[];
  min?: number;
  max?: number;
  tenantEditable: boolean;
}

export interface ResolvedSetting<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValues[K];
  source: SettingSource;
  /** True when the platform owner pinned the value for this tenant. */
  locked: boolean;
}

export const isSettingKey = (key: string): key is SettingKey => key in SETTING_DEFINITIONS;

export const describeSetting = (key: SettingKey): SettingDescriptor => {
  const def = SETTING_DEFINITIONS[key] as Definition;
  return {
    key,
    category: def.category,
    type: def.type,
    default: def.default,
    options: "options" in def ? def.options : undefined,
    min: def.type === "number" ? def.min : undefined,
    max: def.type === "number" ? def.max : undefined,
    tenantEditable: def.tenantEditable,
  };
};

export class SettingValidationError extends Error {}

/** Validates an untrusted value against a setting's definition and returns the typed value. */
export const parseSettingValue = <K extends SettingKey>(key: K, value: unknown): SettingValues[K] => {
  const def = SETTING_DEFINITIONS[key] as Definition;
  const fail = (why: string): never => {
    throw new SettingValidationError(`${key}: ${why}`);
  };
  switch (def.type) {
    case "boolean":
      if (typeof value !== "boolean") fail("must be true or false");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isInteger(value)) fail("must be a whole number");
      if ((value as number) < def.min || (value as number) > def.max) {
        fail(`must be between ${def.min} and ${def.max}`);
      }
      break;
    case "enum":
      if (typeof value !== "string" || !def.options.includes(value)) {
        fail(`must be one of: ${def.options.join(", ")}`);
      }
      break;
    case "enum_list": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !def.options.includes(v))) {
        fail(`must be a list containing only: ${def.options.join(", ")}`);
      }
      const unique = [...new Set(value as string[])];
      if (unique.length === 0) fail("must contain at least one option");
      return unique as SettingValues[K];
    }
  }
  return value as SettingValues[K];
};

export const defaultSettingValue = <K extends SettingKey>(key: K): SettingValues[K] => {
  const def = SETTING_DEFINITIONS[key] as Definition;
  return (Array.isArray(def.default) ? [...def.default] : def.default) as SettingValues[K];
};
