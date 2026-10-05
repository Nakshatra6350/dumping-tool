import type { SessionView } from "@dbrb/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SESSION_QUERY_KEY } from "../../app/session";
import { Icon } from "../../components/Icon";
import { BrandLockup } from "../../components/Logo";
import { Banner, Button, Field, PasswordInput, TextInput } from "../../components/ui";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/i18n";
import { AuthLayout } from "./AuthLayout";

export const LoginPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Translation keys, so a shown error follows the language if it is switched.
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [shake, setShake] = useState(false);

  useEffect(() => {
    document.title = `${t("auth.login.submit")} · DBRB`;
  }, [t]);

  const login = useMutation({
    mutationFn: () => api.post<SessionView>("/auth/login", { email: email.trim(), password }),
    onSuccess: (session) => queryClient.setQueryData(SESSION_QUERY_KEY, session),
    onError: () => {
      setShake(true);
      setTimeout(() => setShake(false), 500);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : "auth.validation.email",
      password: password ? undefined : "auth.validation.passwordRequired",
    };
    setErrors(next);
    if (!next.email && !next.password) login.mutate();
  };

  return (
    <AuthLayout>
      <form className={clsx("login-card", shake && "shake")} onSubmit={submit} noValidate>
        <div className="brand">
          <BrandLockup />
        </div>
        <h1>{t("auth.login.title")}</h1>
        <p className="muted lead">{t("auth.login.subtitle")}</p>

        <div className="stack">
          <Field label={t("auth.fields.email")} error={errors.email && t(errors.email)}>
            {(field) => (
              <TextInput
                {...field}
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={t("auth.fields.password")} error={errors.password && t(errors.password)}>
            {(field) => (
              <PasswordInput
                {...field}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          {login.isError && <Banner tone="danger">{errorMessage(login.error)}</Banner>}

          <Button type="submit" variant="primary" block loading={login.isPending} className="tall">
            {t("auth.login.submit")} <Icon name="chevronRight" />
          </Button>
        </div>

        <p className="auth-switch">
          {t("auth.login.noAccount")} <Link to="/signup">{t("auth.login.createOne")}</Link>
        </p>
      </form>
    </AuthLayout>
  );
};
