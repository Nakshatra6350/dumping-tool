import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/Icon";
import { BrandLockup } from "../../components/Logo";
import { LanguageSwitch, ThemeToggle } from "../shell/controls";

const POINTS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "database", title: "auth.points.isolationTitle", text: "auth.points.isolationText" },
  { icon: "cloud", title: "auth.points.storageTitle", text: "auth.points.storageText" },
  { icon: "shield", title: "auth.points.auditTitle", text: "auth.points.auditText" },
];

/** The two-panel frame shared by the sign-in and sign-up pages. */
export const AuthLayout = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  return (
    <div className="login">
      <section className="login-hero" aria-hidden="true">
        <div className="hero-grid" />
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />

        <div className="hero-content">
          <BrandLockup iconSize={36} wordmarkHeight={18} />
        </div>

        <div className="hero-content">
          <h2 className="hero-title">
            {t("auth.heroTitle")} <span className="gradient-text">{t("auth.heroTitleAccent")}</span>
          </h2>
          <p className="muted hero-text">{t("auth.heroText")}</p>
          <ul className="hero-points">
            {POINTS.map((point, i) => (
              <li key={point.title} style={{ "--i": i } as CSSProperties}>
                <span className="icon-bubble">
                  <Icon name={point.icon} />
                </span>
                <div>
                  <strong>{t(point.title)}</strong>
                  {t(point.text)}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="terminal">
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
          <div className="line" style={{ "--i": 0 } as CSSProperties}>
            <span className="dim">$</span> {t("auth.terminal.command")}
          </div>
          <div className="line" style={{ "--i": 1 } as CSSProperties}>
            <span className="ok">✔</span> {t("auth.terminal.stored")} <span className="dim">(18.4 MB)</span>
          </div>
          <div className="line" style={{ "--i": 2 } as CSSProperties}>
            <span className="ok">✔</span> {t("auth.terminal.verified")}
          </div>
          <div className="line caret" style={{ "--i": 3 } as CSSProperties}>
            <span className="dim">{t("auth.terminal.next")}</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="auth-controls">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
        {children}
      </section>
    </div>
  );
};
