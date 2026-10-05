import { SETTING_KEYS, STORAGE_MODES, SUPPORTED_LOCALES } from "@dbrb/shared";
import { describe, expect, it } from "vitest";
import { keyOf } from "../lib/keyOf";
import { en } from "./en";
import { hi } from "./hi";

type Tree = { [key: string]: string | Tree };

/** Every translation as a flat "a.b.c" -> text map. */
const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...all, [path]: value } : { ...all, ...flatten(value, path) };
  }, {});

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort();

const english = flatten(en);
const languages: Record<string, Record<string, string>> = { en: english, hi: flatten(hi) };

describe("translations", () => {
  it("has a file for every supported language", () => {
    expect(Object.keys(languages).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  // The compiler already guarantees every language has the same keys. It cannot
  // see inside the strings, which is where a translation usually goes wrong.
  it.each(Object.keys(languages))(
    "%s fills in the same values as English and leaves nothing empty",
    (code) => {
      const translated = languages[code]!;
      for (const [key, text] of Object.entries(english)) {
        expect(translated[key], key).toBeTruthy();
        expect(placeholders(translated[key]!), key).toEqual(placeholders(text));
      }
    },
  );

  // These keys are built from values the server sends, so nothing checks them at compile time.
  it.each(Object.keys(languages))("%s names every storage option and every setting", (code) => {
    const translated = languages[code]!;
    for (const mode of STORAGE_MODES) {
      expect(translated[`storage.modes.${mode}`], mode).toBeTruthy();
      expect(translated[`storage.modeText.${mode}`], mode).toBeTruthy();
    }
    for (const source of ["forced", "tenant", "platform_default", "fallback"]) {
      expect(translated[`storage.source.${source}`], source).toBeTruthy();
    }
    for (const step of ["write", "read", "signed_url", "delete"]) {
      expect(translated[`check.${step}`], step).toBeTruthy();
    }
    for (const setting of SETTING_KEYS) {
      expect(translated[`activity.settingNames.${keyOf(setting)}`], setting).toBeTruthy();
    }
  });
});
