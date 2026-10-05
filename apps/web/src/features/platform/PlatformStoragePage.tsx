import {
  STORAGE_MODES,
  type PlatformStorageView,
  type S3TargetInput,
  type S3TargetView,
  type StorageCheckResult,
  type StorageMode,
} from "@dbrb/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon";
import {
  Banner,
  Button,
  Card,
  CardHead,
  EmptyState,
  PageHead,
  Pill,
  Segmented,
  Skeleton,
  Switch,
} from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/i18n";
import { toast } from "../../lib/toast";
import { MODE_ICONS } from "../storage/modes";
import { CheckSteps, S3TargetForm, TargetSummary } from "../storage/parts";

const KEY = ["platform", "storage"] as const;

interface Rules {
  defaultMode: StorageMode;
  allowedModes: StorageMode[];
}

const sameRules = (a: Rules, b: Rules) =>
  a.defaultMode === b.defaultMode && [...a.allowedModes].sort().join() === [...b.allowedModes].sort().join();

export const PlatformStoragePage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Rules | null>(null);
  const [editingBucket, setEditingBucket] = useState(false);
  const [bucketCheck, setBucketCheck] = useState<StorageCheckResult | null>(null);
  const [localCheck, setLocalCheck] = useState<StorageCheckResult | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<PlatformStorageView>("/platform/storage"),
  });
  const onError = (err: unknown) => toast({ type: "error", title: errorMessage(err) });

  const saveRules = useMutation({
    mutationFn: (rules: Rules) => api.put<PlatformStorageView>("/platform/storage/rules", rules),
    onSuccess: (view) => {
      queryClient.setQueryData(KEY, view);
      setDraft(null);
      toast({ type: "success", title: t("platform.storage.rulesSaved") });
    },
    onError,
  });

  const testBucket = useMutation({
    mutationFn: () =>
      api.post<{ check: StorageCheckResult; storage: PlatformStorageView }>("/platform/storage/s3/check"),
    onMutate: () => setBucketCheck(null),
    onSuccess: ({ check, storage }) => {
      setBucketCheck(check);
      queryClient.setQueryData(KEY, storage);
    },
    onError,
  });

  const testLocal = useMutation({
    mutationFn: () => api.post<{ check: StorageCheckResult }>("/platform/storage/local/check"),
    onMutate: () => setLocalCheck(null),
    onSuccess: ({ check }) => setLocalCheck(check),
    onError,
  });

  const pin = useMutation({
    mutationFn: ({ tenantId, mode }: { tenantId: string; name: string; mode: StorageMode | null }) =>
      api.put<PlatformStorageView>(`/platform/tenants/${tenantId}/storage`, { mode }),
    onSuccess: (view, { name, mode }) => {
      queryClient.setQueryData(KEY, view);
      toast({
        type: "success",
        title: mode
          ? t("platform.storage.pinned", { workspace: name, mode: t(`storage.modes.${mode}`) })
          : t("platform.storage.unpinned", { workspace: name }),
      });
    },
    onError,
  });

  const saveBucket = async (input: S3TargetInput) => {
    const result = await api.put<{
      target: S3TargetView;
      check: StorageCheckResult;
      storage: PlatformStorageView;
    }>("/platform/storage/s3", input);
    queryClient.setQueryData(KEY, result.storage);
    return result;
  };

  const head = <PageHead title={t("platform.storage.title")} subtitle={t("platform.storage.subtitle")} />;
  if (isPending) {
    return (
      <>
        {head}
        <div className="stack">
          <Skeleton height={210} />
          <Skeleton height={200} />
          <Skeleton height={180} />
        </div>
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        {head}
        <Banner tone="danger">{errorMessage(error)}</Banner>
      </>
    );
  }

  const saved: Rules = { defaultMode: data.defaultMode, allowedModes: data.allowedModes };
  const rules = draft ?? saved;
  const dirty = draft !== null && !sameRules(draft, saved);
  const bucketReady = data.platformS3?.lastCheckOk === true;

  const setDefault = (mode: StorageMode) =>
    setDraft({
      defaultMode: mode,
      allowedModes: rules.allowedModes.includes(mode) ? rules.allowedModes : [...rules.allowedModes, mode],
    });
  const toggleAllowed = (mode: StorageMode, on: boolean) =>
    setDraft({
      ...rules,
      allowedModes: on ? [...rules.allowedModes, mode] : rules.allowedModes.filter((m) => m !== mode),
    });

  return (
    <>
      {head}

      <div className="stack stagger">
        {/* Rules */}
        <Card style={{ "--i": 0 } as CSSProperties}>
          <CardHead title={t("platform.storage.rules")} />
          <div className="card-pad stack">
            <div className="rule-row">
              <div>
                <div className="rule-title">{t("platform.storage.defaultMode")}</div>
                <div className="hint">{t("platform.storage.defaultHint")}</div>
              </div>
              <Segmented<StorageMode>
                label={t("platform.storage.defaultMode")}
                value={rules.defaultMode}
                onChange={setDefault}
                options={[
                  {
                    value: "local",
                    label: (
                      <>
                        <Icon name="hardDrive" size={15} /> {t("storage.modes.local")}
                      </>
                    ),
                  },
                  {
                    value: "platform_s3",
                    label: (
                      <>
                        <Icon name="cloud" size={15} /> {t("storage.modes.platform_s3")}
                      </>
                    ),
                    disabled: !bucketReady,
                  },
                ]}
              />
            </div>
            {!bucketReady && (
              <p className="hint with-icon">
                <Icon name="info" size={15} />
                <span>{t("platform.storage.bucketFirst")}</span>
              </p>
            )}

            <div className="rule-row top">
              <div>
                <div className="rule-title">{t("platform.storage.allowed")}</div>
                <div className="hint">{t("platform.storage.allowedHint")}</div>
              </div>
              <div className="allowed-list">
                {STORAGE_MODES.map((mode) => (
                  <Switch
                    key={mode}
                    checked={rules.allowedModes.includes(mode)}
                    disabled={mode === rules.defaultMode}
                    onChange={(on) => toggleAllowed(mode, on)}
                    label={
                      <span className="allowed-label">
                        <Icon name={MODE_ICONS[mode]} size={15} /> {t(`storage.modes.${mode}`)}
                      </span>
                    }
                  />
                ))}
                <div className="hint">{t("platform.storage.defaultAlwaysAllowed")}</div>
              </div>
            </div>

            <div className="row">
              <Button
                variant="primary"
                icon="check"
                disabled={!dirty}
                loading={saveRules.isPending}
                onClick={() => saveRules.mutate(rules)}
              >
                {t("platform.storage.saveRules")}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* The managed bucket */}
        <Card style={{ "--i": 1 } as CSSProperties}>
          <CardHead title={t("platform.storage.managedBucket")} subtitle={t("platform.storage.managedText")}>
            {data.platformS3 && (
              <Pill tone={bucketReady ? "success" : "danger"} icon={bucketReady ? "check" : "alert"}>
                {bucketReady ? t("storage.ownBucket.connected") : t("storage.ownBucket.testFailed")}
              </Pill>
            )}
          </CardHead>
          <div className="card-pad">
            {editingBucket ? (
              <S3TargetForm
                target={data.platformS3}
                onSave={saveBucket}
                onSaved={() => {
                  toast({ type: "success", title: t("s3.saved") });
                  setBucketCheck(null);
                  setTimeout(() => setEditingBucket(false), 1400);
                }}
                onCancel={() => setEditingBucket(false)}
              />
            ) : data.platformS3 ? (
              <div className="stack">
                <TargetSummary target={data.platformS3} />
                {(testBucket.isPending || bucketCheck) && (
                  <div className={clsx("check-panel", bucketCheck && (bucketCheck.ok ? "ok" : "failed"))}>
                    <div className="check-title">
                      {testBucket.isPending
                        ? t("s3.testing")
                        : bucketCheck?.ok
                          ? t("check.passed")
                          : t("storage.ownBucket.testFailed")}
                    </div>
                    <CheckSteps result={bucketCheck} running={testBucket.isPending} />
                  </div>
                )}
                <div className="row">
                  <Button icon="refresh" loading={testBucket.isPending} onClick={() => testBucket.mutate()}>
                    {t("storage.ownBucket.testAgain")}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingBucket(true)}>
                    {t("common.edit")}
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState
                icon="cloud"
                title={t("platform.storage.noBucket")}
                text={t("platform.storage.managedText")}
              >
                <Button variant="primary" icon="plug" onClick={() => setEditingBucket(true)}>
                  {t("platform.storage.setUpBucket")}
                </Button>
              </EmptyState>
            )}
          </div>
        </Card>

        {/* Local disk */}
        <Card style={{ "--i": 2 } as CSSProperties}>
          <CardHead
            title={t("platform.storage.localDisk")}
            subtitle={
              <span className="mono">{t("platform.storage.localText", { dir: data.localDirectory })}</span>
            }
          >
            <Button icon="refresh" size="sm" loading={testLocal.isPending} onClick={() => testLocal.mutate()}>
              {t("platform.storage.testLocal")}
            </Button>
          </CardHead>
          {(testLocal.isPending || localCheck) && (
            <div className="card-pad">
              <div className={clsx("check-panel", localCheck && (localCheck.ok ? "ok" : "failed"))}>
                <div className="check-title">
                  {testLocal.isPending
                    ? t("common.loading")
                    : localCheck?.ok
                      ? t("platform.storage.localOk")
                      : t("check.failed")}
                </div>
                <CheckSteps result={localCheck} running={testLocal.isPending} />
              </div>
            </div>
          )}
        </Card>

        {/* Every workspace */}
        <Card style={{ "--i": 3 } as CSSProperties}>
          <CardHead
            title={t("platform.storage.workspaces")}
            subtitle={t("platform.storage.workspacesText")}
          />
          {data.tenants.length === 0 ? (
            <EmptyState icon="building" title={t("platform.storage.noWorkspaces")} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("platform.storage.columns.workspace")}</th>
                  <th>{t("platform.storage.columns.storage")}</th>
                  <th>{t("platform.storage.columns.decidedBy")}</th>
                  <th className="actions">{t("platform.storage.columns.pin")}</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((row) => (
                  <tr key={row.tenant.id}>
                    <td className="primary-cell">
                      <div className="cell-main">{row.tenant.name}</div>
                      <div className="cell-sub mono">{row.tenant.slug}</div>
                    </td>
                    <td data-label={t("platform.storage.columns.storage")}>
                      <Pill
                        tone={row.source === "fallback" ? "warn" : "neutral"}
                        icon={MODE_ICONS[row.effectiveMode]}
                      >
                        {t(`storage.modes.${row.effectiveMode}`)}
                      </Pill>
                    </td>
                    <td data-label={t("platform.storage.columns.decidedBy")}>
                      <span className={clsx(row.source === "forced" && "strong")}>
                        {t(`storage.source.${row.source}`)}
                      </span>
                    </td>
                    <td className="actions" data-label={t("platform.storage.columns.pin")}>
                      <select
                        className="input compact"
                        aria-label={`${t("platform.storage.columns.pin")}: ${row.tenant.name}`}
                        value={row.forcedMode ?? ""}
                        disabled={pin.isPending}
                        onChange={(e) =>
                          pin.mutate({
                            tenantId: row.tenant.id,
                            name: row.tenant.name,
                            mode: (e.target.value || null) as StorageMode | null,
                          })
                        }
                      >
                        <option value="">{t("platform.storage.notPinned")}</option>
                        {STORAGE_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {t(`storage.modes.${mode}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
};
