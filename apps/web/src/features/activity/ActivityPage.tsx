import { isStorageMode, type AuditEntryView, type AuditPage, type AuditVerification } from "@dbrb/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useCan, useFormat } from "../../app/session";
import { Icon, type IconName } from "../../components/Icon";
import { Banner, Button, Card, EmptyState, PageHead, Pill, Segmented, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage, keyOf } from "../../lib/i18n";

type Filter = "" | "auth." | "storage." | "settings.";

const iconFor = (action: string): IconName => {
  if (action.startsWith("auth.")) return action === "auth.login_failed" ? "alert" : "user";
  if (action.startsWith("storage.")) return "hardDrive";
  if (action.startsWith("settings.")) return "sliders";
  if (action.startsWith("workspace.")) return "building";
  if (action.startsWith("audit.")) return "download";
  return "activity";
};

/** Renders a stored value the way a person would say it. */
const display = (value: unknown, t: TFunction): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return t(value ? "common.on" : "common.off");
  if (isStorageMode(value)) return t(`storage.modes.${value}`);
  if (Array.isArray(value)) return value.map((v) => display(v, t)).join(", ");
  return String(value);
};

/** The one-line explanation under an entry's title. */
const describe = (entry: AuditEntryView, t: TFunction): string | null => {
  const meta = entry.metadata ?? {};
  const settingKey =
    entry.targetType === "setting" ? entry.targetId : typeof meta.key === "string" ? meta.key : null;

  if (settingKey) {
    const name = t(`activity.settingNames.${keyOf(settingKey)}`, { defaultValue: settingKey });
    if ("to" in meta || "from" in meta) {
      return `${name}: ${display(meta.from, t)} → ${display(meta.to, t)}`;
    }
    return name;
  }
  if (entry.action === "storage.target.saved") {
    return [meta.bucket, meta.endpoint, meta.region].filter(Boolean).join(" · ");
  }
  if (entry.action === "storage.target.checked") {
    return meta.ok
      ? t("check.passed")
      : `${t("storage.ownBucket.testFailed")}${meta.failedStep ? `: ${t(`check.${String(meta.failedStep)}`)}` : ""}`;
  }
  if (entry.action === "workspace.created" && typeof meta.name === "string") return meta.name;
  return null;
};

interface AuditViewProps {
  title: string;
  subtitle: string;
  /** API path of the log: the workspace's own, or the platform's. */
  basePath: "/audit" | "/platform/audit";
  canExport: boolean;
}

/** A tamper-evident activity log: filterable, pageable, verifiable and exportable. */
const AuditView = ({ title, subtitle, basePath, canExport }: AuditViewProps) => {
  const { t } = useTranslation();
  const format = useFormat();
  const [filter, setFilter] = useState<Filter>("");

  const log = useInfiniteQuery({
    queryKey: ["audit", basePath, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<AuditPage>(
        `${basePath}?limit=30${filter ? `&action=${filter}` : ""}${pageParam ? `&before=${pageParam}` : ""}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });

  const verification = useQuery({
    queryKey: ["audit-verify", basePath],
    queryFn: () => api.get<AuditVerification>(`${basePath}/verify`),
    staleTime: 0,
  });

  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  const actor = (entry: AuditEntryView): string => {
    if (entry.actorType === "system") return t("activity.system");
    if (entry.actorType === "platform")
      return `${t("activity.platformStaff")}${entry.actorLabel ? ` (${entry.actorLabel})` : ""}`;
    return entry.actorLabel ?? "—";
  };

  return (
    <>
      <PageHead title={title} subtitle={subtitle}>
        {verification.isPending ? (
          <Pill icon="refresh">{t("activity.verifying")}</Pill>
        ) : verification.data?.ok ? (
          <Pill tone="success" icon="shield">
            {t("activity.verified", { count: verification.data.entries })}
          </Pill>
        ) : verification.data ? (
          <Pill tone="danger" icon="alert">
            {t("activity.broken", { seq: verification.data.brokenAtSeq })}
          </Pill>
        ) : null}
        {canExport && (
          <a className="btn" href="/api/v1/audit/export" download>
            <Icon name="download" /> {t("activity.export")}
          </a>
        )}
      </PageHead>

      <Card>
        <div className="toolbar">
          <Segmented<Filter>
            label={t("activity.title")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "", label: t("activity.filters.all") },
              { value: "auth.", label: t("activity.filters.auth") },
              { value: "storage.", label: t("activity.filters.storage") },
              { value: "settings.", label: t("activity.filters.settings") },
            ]}
          />
        </div>

        {log.isPending ? (
          <div className="card-pad stack">
            <Skeleton height={52} />
            <Skeleton height={52} />
            <Skeleton height={52} />
          </div>
        ) : log.isError ? (
          <div className="card-pad">
            <Banner tone="danger">{errorMessage(log.error)}</Banner>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon="activity" title={t(filter ? "activity.emptyFiltered" : "activity.empty")} />
        ) : (
          <ol className="timeline">
            {entries.map((entry, i) => {
              const detail = describe(entry, t);
              return (
                <li key={entry.id} style={{ "--i": Math.min(i, 12) } as CSSProperties}>
                  <span className={`timeline-icon ${entry.action === "auth.login_failed" ? "danger" : ""}`}>
                    <Icon name={iconFor(entry.action)} size={16} />
                  </span>
                  <div className="timeline-body">
                    <div className="timeline-title">
                      {t(`activity.actions.${keyOf(entry.action)}`, { defaultValue: entry.action })}
                    </div>
                    {detail && <div className="timeline-detail">{detail}</div>}
                    <div className="timeline-meta">
                      {t("activity.by", { actor: actor(entry) })}
                      {entry.ip && <span className="mono"> · {entry.ip}</span>}
                    </div>
                  </div>
                  <div className="timeline-when" title={format.dateTime(entry.ts)}>
                    <div>{format.ago(entry.ts)}</div>
                    <div className="timeline-seq mono">#{entry.seq}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {log.hasNextPage && (
          <div className="card-pad center">
            <Button onClick={() => void log.fetchNextPage()} loading={log.isFetchingNextPage}>
              {t("activity.loadMore")}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
};

export const ActivityPage = () => {
  const { t } = useTranslation();
  const canExport = useCan("audit.export");
  return (
    <AuditView
      title={t("activity.title")}
      subtitle={t("activity.subtitle")}
      basePath="/audit"
      canExport={canExport}
    />
  );
};

export const PlatformActivityPage = () => {
  const { t } = useTranslation();
  return (
    <AuditView
      title={t("platform.activity.title")}
      subtitle={t("platform.activity.subtitle")}
      basePath="/platform/audit"
      canExport={false}
    />
  );
};
