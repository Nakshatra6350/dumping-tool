import type { AuditPage, AuditVerification, TenantStorageView } from "@dbrb/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCan, useFormat, useSession } from "../../app/session";
import { Icon, type IconName } from "../../components/Icon";
import { Card, CardHead, PageHead, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { keyOf } from "../../lib/i18n";
import { MODE_ICONS } from "../storage/modes";

const Fact = ({
  icon,
  label,
  value,
  index,
  tone,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  index: number;
  tone?: "good" | "warn";
}) => (
  <Card className="stat" style={{ "--i": index } as CSSProperties}>
    <div className="stat-label">
      <span className="icon-bubble">
        <Icon name={icon} size={16} />
      </span>
      {label}
    </div>
    <div className={clsx("stat-value", tone)}>{value}</div>
  </Card>
);

interface StepProps {
  done?: boolean;
  soon?: boolean;
  title: string;
  text: string;
  children?: ReactNode;
}

const Step = ({ done, soon, title, text, children }: StepProps) => {
  const { t } = useTranslation();
  return (
    <li className={clsx("setup-step", done && "done", soon && "soon")}>
      <span className="setup-dot">{done && <Icon name="check" size={14} />}</span>
      <div className="setup-body">
        <div className="setup-title">
          {title}
          {soon && <span className="soon-tag">{t("common.soon")}</span>}
        </div>
        <div className="setup-text">{text}</div>
      </div>
      {children}
    </li>
  );
};

export const OverviewPage = () => {
  const { t } = useTranslation();
  const session = useSession();
  const format = useFormat();
  const canSeeAudit = useCan("audit.read");

  const storage = useQuery({ queryKey: ["storage"], queryFn: () => api.get<TenantStorageView>("/storage") });
  const recent = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: () => api.get<AuditPage>("/audit?limit=6"),
    enabled: canSeeAudit,
  });
  const verification = useQuery({
    queryKey: ["audit-verify", "/audit"],
    queryFn: () => api.get<AuditVerification>("/audit/verify"),
    enabled: canSeeAudit,
  });

  const mode = storage.data?.effective.mode;
  // "Chosen" once the workspace has picked a mode itself or connected its own bucket.
  const storageChosen = Boolean(
    storage.data && (storage.data.choice || storage.data.ownS3 || storage.data.effective.locked),
  );
  const firstName = session.user.name.split(/\s+/)[0];

  return (
    <>
      <PageHead title={t("overview.greeting", { name: firstName })} subtitle={t("overview.subtitle")} />

      <Card className="ready-card">
        <span className="ready-icon">
          <Icon name="shield" size={24} />
        </span>
        <div>
          <h2>{t("overview.readyTitle")}</h2>
          <p>{t("overview.readyText", { workspace: session.tenant.name })}</p>
        </div>
      </Card>

      <div className="bento three stagger">
        <Fact
          index={0}
          icon="database"
          label={t("overview.facts.isolation")}
          value={t("overview.facts.isolationValue")}
          tone="good"
        />
        <Fact
          index={1}
          icon={mode ? MODE_ICONS[mode] : "hardDrive"}
          label={t("overview.facts.storage")}
          value={mode ? t(`storage.modes.${mode}`) : <Skeleton height={28} style={{ width: 140 }} />}
        />
        {canSeeAudit && (
          <Fact
            index={2}
            icon="shield"
            label={t("overview.facts.audit")}
            tone={verification.data ? (verification.data.ok ? "good" : "warn") : undefined}
            value={
              verification.data ? (
                verification.data.ok ? (
                  t("overview.facts.auditValue", { count: verification.data.entries })
                ) : (
                  t("overview.facts.auditBroken")
                )
              ) : (
                <Skeleton height={28} style={{ width: 160 }} />
              )
            }
          />
        )}
      </div>

      <div className="dash-grid stagger">
        <Card style={{ "--i": 3 } as CSSProperties}>
          <CardHead title={t("overview.setup.title")} />
          <ol className="setup">
            <Step done title={t("overview.setup.workspace")} text={t("overview.setup.workspaceDone")} />
            <Step
              done={storageChosen}
              title={t("overview.setup.storage")}
              text={
                storageChosen && mode
                  ? t("overview.setup.storageDone", { mode: t(`storage.modes.${mode}`) })
                  : t("overview.setup.storageTodo")
              }
            >
              <Link to="/settings/storage" className={clsx("btn sm", !storageChosen && "primary")}>
                {t("overview.setup.storageAction")} <Icon name="chevronRight" size={15} />
              </Link>
            </Step>
            <Step soon title={t("overview.setup.database")} text={t("overview.setup.databaseSoon")} />
            <Step soon title={t("overview.setup.backup")} text={t("overview.setup.backupSoon")} />
          </ol>
        </Card>

        {canSeeAudit && (
          <Card style={{ "--i": 4 } as CSSProperties}>
            <CardHead title={t("overview.recent")}>
              <Link to="/activity" className="btn ghost sm">
                {t("overview.viewAll")} <Icon name="chevronRight" size={15} />
              </Link>
            </CardHead>
            {recent.isPending ? (
              <div className="card-pad stack">
                <Skeleton height={40} />
                <Skeleton height={40} />
                <Skeleton height={40} />
              </div>
            ) : recent.data && recent.data.entries.length > 0 ? (
              <div className="list wrap">
                {recent.data.entries.map((entry) => (
                  <div className="list-item" key={entry.id}>
                    <div className="grow">
                      <div className="title">
                        {t(`activity.actions.${keyOf(entry.action)}`, { defaultValue: entry.action })}
                      </div>
                      <div className="sub">
                        {entry.actorType === "system" ? t("activity.system") : entry.actorLabel}
                      </div>
                    </div>
                    <span className="faint nowrap" title={format.dateTime(entry.ts)}>
                      {format.ago(entry.ts)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="card-pad muted">{t("overview.noActivity")}</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
};
