import clsx from "clsx";
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { dismissToast, useToasts } from "../lib/toast";
import { Icon, type IconName } from "./Icon";

// -- Buttons ------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
}

export const Button = ({
  variant = "default",
  size = "md",
  icon,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) => (
  <button
    type="button"
    {...rest}
    disabled={disabled || loading}
    className={clsx(
      "btn",
      variant !== "default" && variant,
      size === "sm" && "sm",
      block && "block",
      !children && "icon-only",
      className,
    )}
  >
    {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
    {children}
  </button>
);

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;

// -- Form fields --------------------------------------------------------------

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}

/** A labelled field with an optional hint and an error message announced to screen readers. */
export const Field = ({ label, hint, error, optional, children }: FieldProps) => {
  const id = useId();
  const { t } = useTranslation();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="field-optional"> ({t("common.optional")})</span>}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
};

export const TextInput = ({
  className,
  mono,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) => (
  <input {...rest} className={clsx("input", mono && "mono", className)} />
);

export const PasswordInput = (props: InputHTMLAttributes<HTMLInputElement>) => {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="input-wrap">
      <input {...props} type={visible ? "text" : "password"} className="input" />
      <button
        type="button"
        className="btn ghost"
        onClick={() => setVisible((v) => !v)}
        aria-label={t(visible ? "auth.fields.hidePassword" : "auth.fields.showPassword")}
      >
        <Icon name={visible ? "eyeOff" : "eye"} />
      </button>
    </div>
  );
};

export const Switch = ({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) => (
  <label className={clsx("switch", disabled && "is-disabled")}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="track" />
    <span>{label}</span>
  </label>
);

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// -- Display ------------------------------------------------------------------

type Tone = "success" | "danger" | "info" | "warn" | "neutral";

const PILL_CLASS: Record<Tone, string> = {
  success: "success",
  danger: "failed",
  info: "running",
  warn: "paused",
  neutral: "",
};

export const Pill = ({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
}) => (
  <span className={clsx("pill", PILL_CLASS[tone])}>
    {icon && <Icon name={icon} />}
    {children}
  </span>
);

export const Banner = ({ tone, icon, children }: { tone: Tone; icon?: IconName; children: ReactNode }) => (
  <div className={clsx("banner", tone)} role={tone === "danger" ? "alert" : "status"}>
    <Icon
      name={icon ?? (tone === "success" ? "check" : tone === "danger" || tone === "warn" ? "alert" : "info")}
    />
    <div>{children}</div>
  </div>
);

export const Card = ({
  className,
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <section className={clsx("card", className)} style={style}>
    {children}
  </section>
);

export const CardHead = ({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="card-head">
    <div>
      <h2>{title}</h2>
      {subtitle && <p className="card-sub">{subtitle}</p>}
    </div>
    {children && <div className="row">{children}</div>}
  </div>
);

export const PageHead = ({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="row">{children}</div>}
  </div>
);

export const Skeleton = ({ height, style }: { height: number; style?: CSSProperties }) => (
  <div className="skeleton" style={{ height, ...style }} />
);

export const EmptyState = ({
  icon,
  title,
  text,
  children,
}: {
  icon: IconName;
  title: ReactNode;
  text?: ReactNode;
  children?: ReactNode;
}) => (
  <div className="empty">
    <div className="empty-art">
      <Icon name={icon} size={28} />
    </div>
    <h3>{title}</h3>
    {text && <p>{text}</p>}
    {children}
  </div>
);

// -- Toasts -------------------------------------------------------------------

export const ToastViewport = () => {
  const toasts = useToasts();
  const { t } = useTranslation();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={clsx("toast", toast.type, toast.leaving && "out")}>
          <div className="t-icon">
            <Icon name={toast.type === "success" ? "check" : toast.type === "error" ? "alert" : "info"} />
          </div>
          <div className="t-body">
            <div className="t-title">{toast.title}</div>
            {toast.message && <div className="t-msg">{toast.message}</div>}
          </div>
          <button
            type="button"
            className="btn ghost sm icon-only"
            onClick={() => dismissToast(toast.id)}
            aria-label={t("common.close")}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
};
