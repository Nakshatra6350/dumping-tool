import {
  STORAGE_MODES,
  type S3TargetInput,
  type S3TargetView,
  type StorageCheckResult,
  type StorageMode,
  type TenantStorageView,
} from "@dbrb/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useCan } from "../../app/session";
import { Icon } from "../../components/Icon";
import { Banner, Button, Card, CardHead, EmptyState, PageHead, Pill, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/i18n";
import { toast } from "../../lib/toast";
import { MODE_ICONS } from "./modes";
import { CheckSteps, S3TargetForm, TargetSummary } from "./parts";

const STORAGE_KEY = ["storage"] as const;
const TTL_CHOICES = [60, 300, 900, 1800, 3600];

interface SaveResponse {
  target: S3TargetView;
  check: StorageCheckResult;
  storage: TenantStorageView;
}

export const StoragePage = () => {
  const { t } = useTranslation();
  const canManage = useCan("storage.manage");
  const canChangeSettings = useCan("settings.manage");
  const queryClient = useQueryClient();
  const [editingBucket, setEditingBucket] = useState(false);
  const [recheck, setRecheck] = useState<StorageCheckResult | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: STORAGE_KEY,
    queryFn: () => api.get<TenantStorageView>("/storage"),
  });

  const setMode = useMutation({
    mutationFn: (mode: StorageMode) => api.put<TenantStorageView>("/storage/mode", { mode }),
    onSuccess: (view, mode) => {
      queryClient.setQueryData(STORAGE_KEY, view);
      toast({ type: "success", title: t("storage.switched", { mode: t(`storage.modes.${mode}`) }) });
    },
    onError: (err) => toast({ type: "error", title: errorMessage(err) }),
  });

  const testBucket = useMutation({
    mutationFn: () =>
      api.post<{ check: StorageCheckResult; storage: TenantStorageView }>("/storage/own-s3/check"),
    onMutate: () => setRecheck(null),
    onSuccess: ({ check, storage }) => {
      setRecheck(check);
      queryClient.setQueryData(STORAGE_KEY, storage);
      toast(
        check.ok
          ? { type: "success", title: t("storage.ownBucket.testPassed") }
          : { type: "error", title: t("storage.ownBucket.testFailed") },
      );
    },
    onError: (err) => toast({ type: "error", title: errorMessage(err) }),
  });

  const setTtl = useMutation({
    mutationFn: (seconds: number) =>
      api.put("/settings/storage.download_url_ttl_seconds", { value: seconds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_KEY });
      toast({ type: "success", title: t("storage.downloads.saved") });
    },
    onError: (err) => toast({ type: "error", title: errorMessage(err) }),
  });

  const saveBucket = async (input: S3TargetInput) => {
    const result = await api.put<SaveResponse>("/storage/own-s3", input);
    queryClient.setQueryData(STORAGE_KEY, result.storage);
    return result;
  };

  if (isPending) {
    return (
      <>
        <PageHead title={t("storage.title")} subtitle={t("storage.subtitle")} />
        <div className="stack">
          <Skeleton height={96} />
          <Skeleton height={190} />
          <Skeleton height={220} />
        </div>
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        <PageHead title={t("storage.title")} subtitle={t("storage.subtitle")} />
        <Banner tone="danger">{errorMessage(error)}</Banner>
      </>
    );
  }

  const { effective } = data;
  const locked = effective.locked;
  // The workspace picked something that the platform's rules or setup no longer permit.
  const overriddenChoice =
    !locked && data.choice && data.choice !== effective.mode && effective.source !== "fallback"
      ? data.choice
      : null;
  const ttlLabel = (seconds: number) =>
    seconds === 3600
      ? t("storage.downloads.hour")
      : t("storage.downloads.minutes", { count: Math.round(seconds / 60) });
  const ttlChoices = TTL_CHOICES.includes(data.downloadUrlTtlSeconds)
    ? TTL_CHOICES
    : [...TTL_CHOICES, data.downloadUrlTtlSeconds].sort((a, b) => a - b);

  return (
    <>
      <PageHead title={t("storage.title")} subtitle={t("storage.subtitle")} />

      <div className="stack stagger">
        {/* What is in effect right now */}
        <Card className="effective-card" style={{ "--i": 0 } as CSSProperties}>
          <span className="effective-icon">
            <Icon name={MODE_ICONS[effective.mode]} size={26} />
          </span>
          <div className="effective-text">
            <div className="effective-label">{t("storage.inEffect")}</div>
            <div className="effective-mode">{t(`storage.modes.${effective.mode}`)}</div>
          </div>
          <Pill
            tone={effective.source === "fallback" ? "warn" : locked ? "info" : "neutral"}
            icon={locked ? "lock" : undefined}
          >
            {t(`storage.source.${effective.source}`)}
          </Pill>
        </Card>

        {locked && (
          <Banner tone="info" icon="lock">
            {t("storage.lockedNotice")}
          </Banner>
        )}
        {overriddenChoice && (
          <Banner tone="warn">
            {t("storage.choiceOverridden", {
              chosen: t(`storage.modes.${overriddenChoice}`),
              current: t(`storage.modes.${effective.mode}`),
            })}
          </Banner>
        )}
        {!canManage && !locked && <Banner tone="info">{t("storage.readOnlyNotice")}</Banner>}

        {/* The three options */}
        <div className="option-grid" style={{ "--i": 1 } as CSSProperties}>
          {STORAGE_MODES.map((mode) => {
            const option = data.options.find((o) => o.mode === mode)!;
            const selected = effective.mode === mode;
            const selectable = canManage && !locked && option.allowed && option.ready && !selected;
            return (
              <button
                key={mode}
                type="button"
                className={clsx(
                  "option-card",
                  selected && "selected",
                  !option.allowed || !option.ready ? "unavailable" : null,
                )}
                disabled={!selectable || setMode.isPending}
                aria-pressed={selected}
                onClick={() => setMode.mutate(mode)}
              >
                <span className="option-icon">
                  <Icon name={MODE_ICONS[mode]} size={22} />
                </span>
                <span className="option-body">
                  <span className="option-title">{t(`storage.modes.${mode}`)}</span>
                  <span className="option-text">{t(`storage.modeText.${mode}`)}</span>
                  {option.reason && (
                    <span className="option-reason">{t(`storage.reasons.${option.reason}`)}</span>
                  )}
                </span>
                <span className="option-state">
                  {selected ? (
                    <Pill tone="success" icon="check">
                      {t("common.selected")}
                    </Pill>
                  ) : !option.allowed ? (
                    <Pill>{t("common.notAllowed")}</Pill>
                  ) : !option.ready ? (
                    <Pill>{t("common.notSetUp")}</Pill>
                  ) : selectable ? (
                    <span className="option-use">
                      {setMode.isPending && setMode.variables === mode ? (
                        <span className="spinner" />
                      ) : (
                        t("storage.use")
                      )}
                    </span>
                  ) : (
                    <Pill tone="neutral">{t("common.ready")}</Pill>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <p className="hint with-icon" style={{ "--i": 2 } as CSSProperties}>
          <Icon name="info" size={15} />
          <span>{t("storage.keepNote")}</span>
        </p>

        {/* The workspace's own bucket */}
        <Card style={{ "--i": 3 } as CSSProperties}>
          <CardHead title={t("storage.ownBucket.title")} subtitle={t("storage.ownBucket.subtitle")}>
            {data.ownS3 && (
              <Pill
                tone={data.ownS3.lastCheckOk ? "success" : "danger"}
                icon={data.ownS3.lastCheckOk ? "check" : "alert"}
              >
                {data.ownS3.lastCheckOk
                  ? t("storage.ownBucket.connected")
                  : t("storage.ownBucket.testFailed")}
              </Pill>
            )}
          </CardHead>

          <div className="card-pad">
            {editingBucket ? (
              <S3TargetForm
                target={data.ownS3}
                onSave={saveBucket}
                onSaved={() => {
                  toast({ type: "success", title: t("s3.saved") });
                  setRecheck(null);
                  setTimeout(() => setEditingBucket(false), 1400);
                }}
                onCancel={() => setEditingBucket(false)}
              />
            ) : data.ownS3 ? (
              <div className="stack">
                <TargetSummary target={data.ownS3} />
                {(testBucket.isPending || recheck) && (
                  <div className={clsx("check-panel", recheck && (recheck.ok ? "ok" : "failed"))}>
                    <div className="check-title">
                      {testBucket.isPending
                        ? t("s3.testing")
                        : recheck?.ok
                          ? t("check.passed")
                          : t("storage.ownBucket.testFailed")}
                    </div>
                    <CheckSteps result={recheck} running={testBucket.isPending} />
                  </div>
                )}
                {canManage && (
                  <div className="row">
                    <Button icon="refresh" loading={testBucket.isPending} onClick={() => testBucket.mutate()}>
                      {t("storage.ownBucket.testAgain")}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingBucket(true)}>
                      {t("common.edit")}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon="key"
                title={t("storage.ownBucket.notConnected")}
                text={t("storage.modeText.own_s3")}
              >
                {canManage && (
                  <Button variant="primary" icon="plug" onClick={() => setEditingBucket(true)}>
                    {t("storage.ownBucket.connect")}
                  </Button>
                )}
              </EmptyState>
            )}
          </div>
        </Card>

        {/* Download link lifetime */}
        <Card style={{ "--i": 4 } as CSSProperties}>
          <CardHead title={t("storage.downloads.title")} subtitle={t("storage.downloads.text")}>
            <select
              className="input compact"
              aria-label={t("storage.downloads.title")}
              value={data.downloadUrlTtlSeconds}
              disabled={!canChangeSettings || setTtl.isPending}
              onChange={(e) => setTtl.mutate(Number(e.target.value))}
            >
              {ttlChoices.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {ttlLabel(seconds)}
                </option>
              ))}
            </select>
          </CardHead>
        </Card>
      </div>
    </>
  );
};
