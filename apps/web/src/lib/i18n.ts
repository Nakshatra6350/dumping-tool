import { DEFAULT_LOCALE, isLocale, type Locale } from "@dbrb/shared";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "../locales/en";
import { hi } from "../locales/hi";
import { ApiError } from "./api";

const STORAGE_KEY = "dbrb-locale";

/** Before sign-in: the last language used on this device, else the browser's. */
const initialLocale = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  const browser = navigator.language.slice(0, 2);
  return isLocale(browser) ? browser : DEFAULT_LOCALE;
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: initialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = i18n.language;

export const setLanguage = (locale: Locale): void => {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable */
  }
};

export const currentLocale = (): Locale => (isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE);

/** The translated message for an error; falls back to the server's own message. */
export const errorMessage = (err: unknown): string => {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    return i18n.exists(key) ? i18n.t(key) : err.message || i18n.t("errors.generic");
  }
  return i18n.t("errors.generic");
};

export { keyOf } from "./keyOf";

export default i18n;
