import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, roleHas } from "./permissions";
import { loginSchema, signupSchema } from "./schemas";
import { SettingValidationError, defaultSettingValue, describeSetting, parseSettingValue } from "./settings";
import { s3TargetInputSchema } from "./storage";

describe("settings registry", () => {
  it("accepts valid values and returns them typed", () => {
    expect(parseSettingValue("storage.mode", "own_s3")).toBe("own_s3");
    expect(parseSettingValue("storage.download_url_ttl_seconds", 600)).toBe(600);
    expect(parseSettingValue("signup.enabled", false)).toBe(false);
    expect(parseSettingValue("storage.allowed_modes", ["local", "local", "own_s3"])).toEqual([
      "local",
      "own_s3",
    ]);
  });

  it("rejects wrong types, unknown options and out-of-range numbers", () => {
    expect(() => parseSettingValue("storage.mode", "ftp")).toThrow(SettingValidationError);
    expect(() => parseSettingValue("storage.mode", 1)).toThrow(SettingValidationError);
    expect(() => parseSettingValue("storage.download_url_ttl_seconds", 5)).toThrow(/between 60 and 3600/);
    expect(() => parseSettingValue("storage.download_url_ttl_seconds", 90.5)).toThrow(/whole number/);
    expect(() => parseSettingValue("signup.enabled", "yes")).toThrow(SettingValidationError);
    expect(() => parseSettingValue("storage.allowed_modes", [])).toThrow(/at least one/);
    expect(() => parseSettingValue("storage.allowed_modes", ["local", "tape"])).toThrow(
      SettingValidationError,
    );
  });

  it("exposes defaults and descriptors for building admin forms", () => {
    expect(defaultSettingValue("storage.mode")).toBe("local");
    expect(describeSetting("storage.mode")).toMatchObject({
      type: "enum",
      tenantEditable: true,
      category: "storage",
    });
    expect(describeSetting("storage.allowed_modes").tenantEditable).toBe(false);
    // Defaults must be copies, so callers cannot mutate the registry.
    const modes = defaultSettingValue("storage.allowed_modes");
    modes.pop();
    expect(defaultSettingValue("storage.allowed_modes")).toHaveLength(3);
  });
});

describe("roles", () => {
  it("gives owners and admins everything, and keeps storage away from operators", () => {
    expect(roleHas("owner", "storage.manage")).toBe(true);
    expect(roleHas("admin", "members.manage")).toBe(true);
    expect(roleHas("operator", "storage.manage")).toBe(false);
    expect(roleHas("operator", "backups.restore")).toBe(true);
    expect(roleHas("viewer", "backups.download")).toBe(false);
    expect(roleHas("auditor", "audit.export")).toBe(true);
    expect(ROLE_PERMISSIONS.viewer.every((p) => p.endsWith(".read"))).toBe(true);
  });
});

describe("schemas", () => {
  it("normalises emails and enforces password length", () => {
    const ok = signupSchema.parse({
      name: " Asha ",
      email: "  Asha@Example.COM ",
      password: "long-enough-pw",
      workspaceName: "Acme",
    });
    expect(ok.email).toBe("asha@example.com");
    expect(ok.name).toBe("Asha");
    expect(
      signupSchema.safeParse({ name: "A", email: "a@b.co", password: "short", workspaceName: "Acme" })
        .success,
    ).toBe(false);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(
      signupSchema.safeParse({
        name: "A",
        email: "a@b.co",
        password: "long-enough-pw",
        workspaceName: "Acme",
        timezone: "Mars/Olympus",
      }).success,
    ).toBe(false);
  });

  it("validates S3 details and tidies the prefix", () => {
    const parsed = s3TargetInputSchema.parse({
      bucket: "my-backups",
      region: "ap-south-1",
      prefix: "/dbrb/prod/",
    });
    expect(parsed).toMatchObject({
      bucket: "my-backups",
      endpoint: "",
      forcePathStyle: false,
      prefix: "dbrb/prod",
    });
    expect(s3TargetInputSchema.safeParse({ bucket: "Bad_Bucket", region: "x" }).success).toBe(false);
    expect(
      s3TargetInputSchema.safeParse({ bucket: "ok-bucket", region: "x", endpoint: "ftp://host" }).success,
    ).toBe(false);
    expect(s3TargetInputSchema.safeParse({ bucket: "ok-bucket", region: "x", prefix: "a b" }).success).toBe(
      false,
    );
  });
});
