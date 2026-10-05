import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_QUERY_KEY, useSession } from "../../app/session";
import { Icon, type IconName } from "../../components/Icon";
import { BrandLockup } from "../../components/Logo";
import { api } from "../../lib/api";
import { initials } from "../../lib/format";
import { LanguageSwitch, ThemeToggle } from "./controls";

type NavPath =
  "/" | "/activity" | "/settings/storage" | "/settings/profile" | "/platform/storage" | "/platform/activity";

const TITLES: Record<NavPath, string> = {
  "/": "nav.overview",
  "/activity": "nav.activity",
  "/settings/storage": "nav.storage",
  "/settings/profile": "nav.profile",
  "/platform/storage": "nav.platformStorage",
  "/platform/activity": "nav.platformActivity",
};

interface NavItemProps {
  to: NavPath;
  icon: IconName;
  label: string;
  exact?: boolean;
  onNavigate: () => void;
}

const NavItem = ({ to, icon, label, exact, onNavigate }: NavItemProps) => (
  <Link
    to={to}
    activeProps={{ className: "active" }}
    activeOptions={{ exact: Boolean(exact) }}
    onClick={onNavigate}
  >
    <Icon name={icon} />
    <span>{label}</span>
  </Link>
);

/** Features that arrive in the next milestone: shown, so the roadmap is visible, but not clickable. */
const ComingSoon = ({ icon, label }: { icon: IconName; label: string }) => {
  const { t } = useTranslation();
  return (
    <span className="nav-soon" aria-disabled="true">
      <Icon name={icon} />
      <span>{label}</span>
      <span className="soon-tag">{t("common.soon")}</span>
    </span>
  );
};

export const AppLayout = () => {
  const session = useSession();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // On small screens the navigation is a drawer. It remembers the page it was
  // opened on, so arriving anywhere else (a link, the back button) closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const navOpen = navOpenOn === pathname;
  const closeNav = () => setNavOpenOn(null);

  const title = t(TITLES[pathname as NavPath] ?? "nav.overview");

  useEffect(() => {
    document.title = `${title} · DBRB`;
  }, [title]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpenOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const signOut = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, null);
    },
  });

  return (
    <div className={clsx("shell", navOpen && "nav-open")}>
      <aside className="sidebar" id="main-nav" aria-label={t("nav.main")}>
        <Link to="/" className="brand" onClick={closeNav}>
          <BrandLockup />
        </Link>

        <div className="workspace-chip">
          <span className="workspace-icon">
            <Icon name="building" size={16} />
          </span>
          <div className="meta">
            <div className="k">{t("nav.workspace")}</div>
            <div className="v" title={session.tenant.name}>
              {session.tenant.name}
            </div>
          </div>
        </div>

        <nav className="nav">
          <NavItem to="/" icon="dashboard" label={t("nav.overview")} exact onNavigate={closeNav} />
          <ComingSoon icon="calendar" label={t("nav.backups")} />
          <ComingSoon icon="archive" label={t("nav.history")} />
          {session.permissions.includes("audit.read") && (
            <NavItem to="/activity" icon="activity" label={t("nav.activity")} onNavigate={closeNav} />
          )}

          <div className="nav-label">{t("nav.settings")}</div>
          <NavItem to="/settings/storage" icon="hardDrive" label={t("nav.storage")} onNavigate={closeNav} />
          <NavItem to="/settings/profile" icon="user" label={t("nav.profile")} onNavigate={closeNav} />

          {session.user.isPlatformAdmin && (
            <>
              <div className="nav-label">{t("nav.platform")}</div>
              <NavItem
                to="/platform/storage"
                icon="sliders"
                label={t("nav.platformStorage")}
                onNavigate={closeNav}
              />
              <NavItem
                to="/platform/activity"
                icon="shield"
                label={t("nav.platformActivity")}
                onNavigate={closeNav}
              />
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar">{initials(session.user.name)}</span>
            <div className="meta">
              <div className="name">{session.user.name}</div>
              <div className="email">{session.user.email}</div>
            </div>
            <button
              type="button"
              className="btn ghost sm icon-only"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              title={t("nav.signOut")}
              aria-label={t("nav.signOut")}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="scrim" onClick={closeNav} />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn ghost icon-only menu-btn"
            onClick={() => setNavOpenOn(pathname)}
            aria-label={t("nav.openMenu")}
            aria-expanded={navOpen}
            aria-controls="main-nav"
          >
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            <span className="crumb-root">
              {session.tenant.name} <Icon name="chevronRight" size={16} />
            </span>
            <strong>{title}</strong>
          </div>
          <div className="spacer" />
          <LanguageSwitch />
          <ThemeToggle />
        </header>
        <main className="content">
          {/* Keyed by path so each page plays its enter animation. */}
          <div className="view" key={pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
