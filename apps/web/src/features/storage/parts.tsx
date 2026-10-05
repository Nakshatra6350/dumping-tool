import type { S3TargetInput, S3TargetView, StorageCheckResult, StorageCheckStep } from "@dbrb/shared";
import clsx from "clsx";
import { useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../app/session";
import { Icon } from "../../components/Icon";
import { Banner, Button, Field, PasswordInput, Switch, TextInput } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/i18n";

const STEP_ORDER: StorageCheckStep["step"][] = ["write", "read", "signed_url", "delete"];

/**
 * Shows the four things the storage self-test does, with the time each took
 * and, when one fails, exactly why. While the test runs the steps pulse.
 */
export const CheckSteps = ({ result, running }: { result: StorageCheckResult | null; running?: boolean }) => {
  const { t } = useTranslation();
  return (
    <ol className="check-steps" aria-label={t("check.title")}>
      {STEP_ORDER.map((name, i) => {
        const step = result?.steps.find((s) => s.step === name);
        const state = running ? "running" : step ? (step.ok ? "ok" : "failed") : "idle";
        return (
          <li key={name} className={state} style={{ "--i": i } as CSSProperties}>
            <span className="check-dot">
              {state === "ok" && <Icon name="check" size={14} />}
              {state === "failed" && <Icon name="x" size={14} />}
            </span>
            <div className="check-text">
              <div className="check-label">{t(`check.${name}`)}</div>
              {step && !step.ok && step.detail && <div className="check-detail">{step.detail}</div>}
            </div>
            <span className="check-ms">{step ? `${step.ms} ms` : running ? "" : t("check.notRun")}</span>
          </li>
        );
      })}
    </ol>
  );
};

/** A read-only summary of a saved bucket. The keys are never shown, only a hint. */
export const TargetSummary = ({ target }: { target: S3TargetView }) => {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <dl className="kv">
      <dt className="k">{t("s3.bucket")}</dt>
      <dd className="v mono">{target.bucket}</dd>
      <dt className="k">{t("s3.region")}</dt>
      <dd className="v mono">{target.region}</dd>
      <dt className="k">{t("s3.endpoint")}</dt>
      <dd className="v mono">{target.endpoint || "Amazon S3"}</dd>
      {target.prefix && (
        <>
          <dt className="k">{t("s3.prefix")}</dt>
          <dd className="v mono">{target.prefix}</dd>
        </>
      )}
      <dt className="k">{t("s3.accessKeyId")}</dt>
      <dd className="v">
        <Icon name="lock" size={14} /> {t("storage.ownBucket.keyEnding", { hint: target.accessKeyIdHint })}
      </dd>
      {target.lastCheckAt && (
        <>
          <dt className="k">{t("storage.ownBucket.lastTested")}</dt>
          <dd className="v">{format.ago(target.lastCheckAt)}</dd>
        </>
      )}
    </dl>
  );
};

interface FormState {
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface S3TargetFormProps {
  /** The saved bucket when editing; null when connecting for the first time. */
  target: S3TargetView | null;
  /** Saves the details. The server tests them first and rejects with the failed check if they don't work. */
  onSave: (input: S3TargetInput) => Promise<{ check: StorageCheckResult }>;
  onSaved: () => void;
  onCancel?: () => void;
}

/**
 * The form where an admin types in S3 details. On submit the server runs the
 * four-step test and only saves if every step passes; the result of each step
 * is shown either way.
 */
export const S3TargetForm = ({ target, onSave, onSaved, onCancel }: S3TargetFormProps) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>({
    bucket: target?.bucket ?? "",
    region: target?.region ?? "ap-south-1",
    endpoint: target?.endpoint ?? "",
    forcePathStyle: target?.forcePathStyle ?? false,
    prefix: target?.prefix ?? "",
    accessKeyId: "",
    secretAccessKey: "",
  });
  const [running, setRunning] = useState(false);
  const [check, setCheck] = useState<StorageCheckResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof FormState) => (event: { target: { value: string } }) =>
    set(key)(event.target.value as never);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRunning(true);
    setError(null);
    setFields({});
    setCheck(null);
    try {
      const result = await onSave({
        bucket: form.bucket.trim(),
        region: form.region.trim(),
        endpoint: form.endpoint.trim(),
        forcePathStyle: form.forcePathStyle,
        prefix: form.prefix.trim(),
        accessKeyId: form.accessKeyId.trim() || undefined,
        secretAccessKey: form.secretAccessKey || undefined,
      });
      setCheck(result.check);
      onSaved();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) {
        setFields(err.fields);
        // A failed test comes back with the result of every step.
        if (err.code === "storage_check_failed") setCheck(err.details as StorageCheckResult);
      }
    } finally {
      setRunning(false);
    }
  };

  const showSteps = running || check !== null;
  const checkFailed = error instanceof ApiError && error.code === "storage_check_failed";

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
      <div className="grid-2">
        <Field label={t("s3.bucket")} error={fields.bucket}>
          {(field) => (
            <TextInput
              {...field}
              mono
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="my-company-backups"
              value={form.bucket}
              onChange={text("bucket")}
            />
          )}
        </Field>
        <Field label={t("s3.region")} hint={t("s3.regionHint")} error={fields.region}>
          {(field) => (
            <TextInput
              {...field}
              mono
              required
              spellCheck={false}
              autoComplete="off"
              value={form.region}
              onChange={text("region")}
            />
          )}
        </Field>
      </div>

      <div className="grid-2">
        <Field label={t("s3.endpoint")} hint={t("s3.endpointHint")} error={fields.endpoint} optional>
          {(field) => (
            <TextInput
              {...field}
              mono
              spellCheck={false}
              autoComplete="off"
              placeholder="https://s3.us-west-004.backblazeb2.com"
              value={form.endpoint}
              onChange={(e) => {
                const value = e.target.value;
                // S3-compatible services almost always need path-style addresses.
                setForm((f) => ({
                  ...f,
                  endpoint: value,
                  forcePathStyle: value ? (f.endpoint ? f.forcePathStyle : true) : false,
                }));
              }}
            />
          )}
        </Field>
        <Field label={t("s3.prefix")} hint={t("s3.prefixHint")} error={fields.prefix} optional>
          {(field) => (
            <TextInput
              {...field}
              mono
              spellCheck={false}
              autoComplete="off"
              value={form.prefix}
              onChange={text("prefix")}
            />
          )}
        </Field>
      </div>

      {form.endpoint && (
        <div>
          <Switch checked={form.forcePathStyle} onChange={set("forcePathStyle")} label={t("s3.pathStyle")} />
          <div className="hint switch-hint">{t("s3.pathStyleHint")}</div>
        </div>
      )}

      <div className="grid-2">
        <Field label={t("s3.accessKeyId")} error={fields.accessKeyId || undefined}>
          {(field) => (
            <TextInput
              {...field}
              mono
              spellCheck={false}
              autoComplete="off"
              value={form.accessKeyId}
              onChange={text("accessKeyId")}
            />
          )}
        </Field>
        <Field label={t("s3.secretAccessKey")} error={fields.secretAccessKey || undefined}>
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="new-password"
              value={form.secretAccessKey}
              onChange={text("secretAccessKey")}
            />
          )}
        </Field>
      </div>

      <p className="hint with-icon">
        <Icon name="lock" size={14} />
        <span>
          {t("s3.encrypted")} {target && t("s3.keepKeys")}
        </span>
      </p>

      {showSteps && (
        <div className={clsx("check-panel", checkFailed && "failed", check?.ok && "ok")}>
          <div className="check-title">
            {running ? t("s3.testing") : check?.ok ? t("check.passed") : t("check.failed")}
          </div>
          <CheckSteps result={check} running={running} />
        </div>
      )}

      {error !== null && !checkFailed && <Banner tone="danger">{errorMessage(error)}</Banner>}

      <div className="row">
        <Button type="submit" variant="primary" icon="plug" loading={running}>
          {t("s3.testAndSave")}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={running}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
};
