import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale, type SessionView } from "@dbrb/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_QUERY_KEY, useSession } from "../../app/session";
import {
  Banner,
  Button,
  Card,
  CardHead,
  Field,
  PageHead,
  PasswordInput,
  Pill,
  TextInput,
} from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { allTimeZones, timeZoneLabel } from "../../lib/format";
import { errorMessage, setLanguage } from "../../lib/i18n";
import { toast } from "../../lib/toast";

export const ProfilePage = () => {
  const { t } = useTranslation();
  const session = useSession();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState({
    name: session.user.name,
    locale: session.user.locale,
    timezone: session.user.timezone,
  });
  // The saved timezone is always offered, even if this browser doesn't list it.
  const timeZones = useMemo(() => {
    const zones = allTimeZones();
    return (zones.includes(session.user.timezone) ? zones : [session.user.timezone, ...zones])
      .map((value) => ({ value, label: timeZoneLabel(value) }))
      .sort((a, b) =>
        a.value === "UTC" ? -1 : b.value === "UTC" ? 1 : a.label.localeCompare(b.label, "en"),
      );
  }, [session.user.timezone]);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  // Translation keys, so a shown error follows the language if it is switched.
  const [passwordErrors, setPasswordErrors] = useState<{ currentPassword?: string; newPassword?: string }>(
    {},
  );

  const saveProfile = useMutation({
    mutationFn: () => api.put<SessionView>("/auth/profile", { ...profile, name: profile.name.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, updated);
      setLanguage(updated.user.locale);
      toast({ type: "success", title: t("profile.saved") });
    },
  });

  const changePassword = useMutation({
    mutationFn: () => api.post("/auth/password", passwords),
    onSuccess: () => {
      setPasswords({ currentPassword: "", newPassword: "" });
      toast({ type: "success", title: t("profile.passwordChanged") });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "wrong_password")
        setPasswordErrors({ currentPassword: "errors.wrong_password" });
    },
  });

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      currentPassword: passwords.currentPassword ? undefined : "auth.validation.passwordRequired",
      newPassword: passwords.newPassword.length >= 10 ? undefined : "auth.validation.password",
    };
    setPasswordErrors(next);
    if (!next.currentPassword && !next.newPassword) changePassword.mutate();
  };

  const wrongPassword =
    changePassword.error instanceof ApiError && changePassword.error.code === "wrong_password";

  return (
    <>
      <PageHead title={t("profile.title")} subtitle={t("profile.subtitle")}>
        <Pill tone="info" icon="shield">
          {t("profile.role", { workspace: session.tenant.name })}: {t(`roles.${session.role}`)}
        </Pill>
      </PageHead>

      <div className="dash-grid stagger">
        <Card style={{ "--i": 0 } as CSSProperties}>
          <CardHead title={t("profile.details")} />
          <form
            className="card-pad stack"
            onSubmit={(e) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
          >
            <Field label={t("profile.name")}>
              {(field) => (
                <TextInput
                  {...field}
                  required
                  maxLength={120}
                  value={profile.name}
                  onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                />
              )}
            </Field>
            <Field label={t("profile.email")}>
              {(field) => <TextInput {...field} value={session.user.email} readOnly disabled />}
            </Field>
            <div className="grid-2">
              <Field label={t("profile.language")}>
                {(field) => (
                  <select
                    {...field}
                    className="input"
                    value={profile.locale}
                    onChange={(e) => setProfile((p) => ({ ...p, locale: e.target.value as Locale }))}
                  >
                    {SUPPORTED_LOCALES.map((locale) => (
                      <option key={locale} value={locale}>
                        {LOCALE_NAMES[locale]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("profile.timezone")}>
                {(field) => (
                  <select
                    {...field}
                    className="input"
                    value={profile.timezone}
                    onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}
                  >
                    {timeZones.map((zone) => (
                      <option key={zone.value} value={zone.value}>
                        {zone.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <p className="hint">{t("profile.timezoneHint")}</p>
            {saveProfile.isError && <Banner tone="danger">{errorMessage(saveProfile.error)}</Banner>}
            <div>
              <Button
                type="submit"
                variant="primary"
                icon="check"
                loading={saveProfile.isPending}
                disabled={!profile.name.trim()}
              >
                {t("common.saveChanges")}
              </Button>
            </div>
          </form>
        </Card>

        <Card style={{ "--i": 1 } as CSSProperties}>
          <CardHead title={t("profile.password")} />
          <form className="card-pad stack" onSubmit={submitPassword} noValidate>
            <Field
              label={t("profile.currentPassword")}
              error={passwordErrors.currentPassword && t(passwordErrors.currentPassword)}
            >
              {(field) => (
                <PasswordInput
                  {...field}
                  autoComplete="current-password"
                  value={passwords.currentPassword}
                  onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label={t("profile.newPassword")}
              hint={t("auth.fields.passwordHint")}
              error={passwordErrors.newPassword && t(passwordErrors.newPassword)}
            >
              {(field) => (
                <PasswordInput
                  {...field}
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
                />
              )}
            </Field>
            {changePassword.isError && !wrongPassword && (
              <Banner tone="danger">{errorMessage(changePassword.error)}</Banner>
            )}
            <div>
              <Button type="submit" icon="lock" loading={changePassword.isPending}>
                {t("profile.updatePassword")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
};
