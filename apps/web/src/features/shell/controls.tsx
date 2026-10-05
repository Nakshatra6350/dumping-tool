import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale, type SessionView } from "@dbrb/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_QUERY_KEY, useOptionalSession } from "../../app/session";
import { Icon } from "../../components/Icon";
import { api } from "../../lib/api";
import { setLanguage } from "../../lib/i18n";

const SHORT: Record<Locale, string> = { en: "EN", hi: "हिं" };

/**
 * Switches the interface language. When signed in, the choice is saved to the
 * profile so emails and other devices use it too.
 */
export const LanguageSwitch = () => {
  const { i18n, t } = useTranslation();
  const session = useOptionalSession();
  const queryClient = useQueryClient();

  const change = async (locale: Locale) => {
    setLanguage(locale);
    if (!session || session.user.locale === locale) return;
    try {
      const updated = await api.put<SessionView>("/auth/profile", {
        name: session.user.name,
        locale,
        timezone: session.user.timezone,
      });
      queryClient.setQueryData(SESSION_QUERY_KEY, updated);
    } catch {
      /* the language still changed on this device */
    }
  };

  return (
    <div className="lang-switch" role="group" aria-label={t("language.label")}>
      {SUPPORTED_LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          title={LOCALE_NAMES[locale]}
          aria-pressed={i18n.language === locale}
          onClick={() => void change(locale)}
        >
          {SHORT[locale]}
        </button>
      ))}
    </div>
  );
};

export const ThemeToggle = () => {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("dbrb-theme", next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  };

  const label = t(theme === "dark" ? "theme.toLight" : "theme.toDark");
  return (
    <button type="button" className="btn ghost icon-only" onClick={toggle} aria-label={label} title={label}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
};
