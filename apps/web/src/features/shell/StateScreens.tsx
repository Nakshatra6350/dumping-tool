import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState } from "../../components/ui";

/** Replaces a page that failed to render, so the rest of the app stays usable. */
export const RouteError = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation();
  return (
    <div className="state-screen" role="alert">
      <EmptyState icon="alert" title={t("errors.crashTitle")} text={t("errors.crashText")}>
        {import.meta.env.DEV && (
          <pre className="state-detail">{error instanceof Error ? error.message : String(error)}</pre>
        )}
        <div className="row">
          <Button variant="primary" icon="refresh" onClick={reset}>
            {t("common.retry")}
          </Button>
          {/* A full page load, not a client-side jump: whatever broke is thrown away. */}
          <a className="btn" href="/">
            {t("errors.backHome")}
          </a>
        </div>
      </EmptyState>
    </div>
  );
};

/** Shown for an address that leads nowhere. */
export const NotFound = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t("errors.notFoundTitle")} · DBRB`;
  }, [t]);

  return (
    <div className="state-screen full">
      <EmptyState icon="globe" title={t("errors.notFoundTitle")} text={t("errors.notFoundText")}>
        <Link to="/" className="btn primary">
          {t("errors.backHome")}
        </Link>
      </EmptyState>
    </div>
  );
};

/** Shown when the app cannot find out who is signed in because the server did not answer. */
export const ServerUnreachable = ({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) => {
  const { t } = useTranslation();
  return (
    <div className="state-screen full" role="alert">
      <EmptyState icon="cloud" title={t("errors.unreachableTitle")} text={t("errors.network_error")}>
        <Button variant="primary" icon="refresh" loading={retrying} onClick={onRetry}>
          {t("common.retry")}
        </Button>
      </EmptyState>
    </div>
  );
};
