import type { SessionView } from "@dbrb/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_QUERY_KEY } from "../../app/session";
import { Icon } from "../../components/Icon";
import { BrandLockup } from "../../components/Logo";
import { Banner, Button, Field, PasswordInput, TextInput } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { browserTimeZone, timeZoneName } from "../../lib/format";
import { currentLocale, errorMessage } from "../../lib/i18n";
import { toast } from "../../lib/toast";
import { AuthLayout } from "./AuthLayout";

type Fields = "name" | "workspaceName" | "email" | "password";

export const SignupPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<Fields, string>>({
    name: "",
    workspaceName: "",
    email: "",
    password: "",
  });
  // Translation keys, so a shown error follows the language if it is switched.
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const timezone = browserTimeZone();

  useEffect(() => {
    document.title = `${t("auth.signup.submit")} · DBRB`;
  }, [t]);

  const set = (field: Fields) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: event.target.value }));

  const signup = useMutation({
    mutationFn: () =>
      api.post<SessionView>("/auth/signup", {
        name: form.name.trim(),
        workspaceName: form.workspaceName.trim(),
        email: form.email.trim(),
        password: form.password,
        locale: currentLocale(),
        timezone,
      }),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      toast({
        type: "success",
        title: t("overview.readyTitle"),
        message: t("overview.readyText", { workspace: session.tenant.name }),
      });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "email_taken") setErrors({ email: "errors.email_taken" });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Partial<Record<Fields, string>> = {};
    if (!form.name.trim()) next.name = "auth.validation.name";
    if (form.workspaceName.trim().length < 2) next.workspaceName = "auth.validation.workspace";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "auth.validation.email";
    if (form.password.length < 10) next.password = "auth.validation.password";
    setErrors(next);
    if (Object.keys(next).length === 0) signup.mutate();
  };

  const showBanner =
    signup.isError && !(signup.error instanceof ApiError && signup.error.code === "email_taken");

  return (
    <AuthLayout>
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand">
          <BrandLockup />
        </div>
        <h1>{t("auth.signup.title")}</h1>
        <p className="muted lead">{t("auth.signup.subtitle")}</p>

        <div className="stack">
          <div className="grid-2">
            <Field label={t("auth.fields.name")} error={errors.name && t(errors.name)}>
              {(field) => (
                <TextInput
                  {...field}
                  autoComplete="name"
                  autoFocus
                  value={form.name}
                  onChange={set("name")}
                />
              )}
            </Field>
            <Field
              label={t("auth.fields.workspace")}
              error={errors.workspaceName && t(errors.workspaceName)}
              hint={t("auth.fields.workspaceHint")}
            >
              {(field) => (
                <TextInput
                  {...field}
                  autoComplete="organization"
                  value={form.workspaceName}
                  onChange={set("workspaceName")}
                />
              )}
            </Field>
          </div>
          <Field label={t("auth.fields.email")} error={errors.email && t(errors.email)}>
            {(field) => (
              <TextInput
                {...field}
                type="email"
                autoComplete="username"
                value={form.email}
                onChange={set("email")}
              />
            )}
          </Field>
          <Field
            label={t("auth.fields.password")}
            error={errors.password && t(errors.password)}
            hint={t("auth.fields.passwordHint")}
          >
            {(field) => (
              <PasswordInput
                {...field}
                autoComplete="new-password"
                value={form.password}
                onChange={set("password")}
              />
            )}
          </Field>

          {showBanner && <Banner tone="danger">{errorMessage(signup.error)}</Banner>}

          <Button type="submit" variant="primary" block loading={signup.isPending} className="tall">
            {signup.isPending ? t("auth.signup.creating") : t("auth.signup.submit")}
            {!signup.isPending && <Icon name="chevronRight" />}
          </Button>

          <p className="hint center">
            <Icon name="globe" size={14} />{" "}
            {t("auth.signup.timezoneNote", { timezone: timeZoneName(timezone) })}
          </p>
        </div>

        <p className="auth-switch">
          {t("auth.signup.haveAccount")} <Link to="/login">{t("auth.signup.signIn")}</Link>
        </p>
      </form>
    </AuthLayout>
  );
};
