/** Languages the product ships in. English and Hindi at launch; more are added here. */
export const SUPPORTED_LOCALES = ["en", "hi"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};

export const isLocale = (value: unknown): value is Locale => SUPPORTED_LOCALES.includes(value as Locale);

/** True for a valid IANA timezone name such as "Asia/Kolkata". */
export const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
