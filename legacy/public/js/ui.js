// ---------------------------------------------------------------------------
// Tiny safe templating: interpolations are HTML-escaped unless wrapped in raw().
// ---------------------------------------------------------------------------
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Raw(String(s));

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (v) => {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join("");
  if (v === null || v === undefined || v === false) return "";
  return escapeHtml(v);
};

export const html = (strings, ...values) =>
  raw(strings.reduce((out, s, i) => out + s + (i < values.length ? fmt(values[i]) : ""), ""));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Icons (Lucide, ISC licensed paths)
// ---------------------------------------------------------------------------
const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  calendar: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4M8 2v4M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-2.93 1.41-1.41m11.32-11.32 1.41-1.41M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  hardDrive: '<path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01M10 16h.01"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .93-.02l6.5-19a.5.5 0 0 0-.63-.63l-19 6.5a.5.5 0 0 0-.03.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
};

export const icon = (name, cls = "") =>
  raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ""}</svg>`);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

export const formatDuration = (ms) => {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (d) => (d ? dtf.format(new Date(d)) : "—");

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export const timeAgo = (d) => {
  if (!d) return "never";
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [value, unit] =
    abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"] : abs < 86400 ? [diff / 3600, "hour"] : [diff / 86400, "day"];
  return rtf.format(Math.round(value), unit);
};

export const countdownText = (target) => {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `in ${d}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${String(m).padStart(2, "0")}m`;
  return `in ${m}m ${String(sec).padStart(2, "0")}s`;
};

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

// Human schedule text in the viewer's locale (server text is the fallback).
export const scheduleText = (job) =>
  job.schedule?.type === "once" && job.schedule.runAt ? `Once on ${formatDate(job.schedule.runAt)}` : job.scheduleText;

export const engineLabel = (t) => (t === "postgres" ? "PostgreSQL" : "MySQL");
export const engineBadge = (t, cls = "") => html`<span class="engine ${t} ${cls}" title="${engineLabel(t)}">${t === "postgres" ? "PG" : "My"}</span>`;

const STATUS = {
  success: { icon: "check", label: "Success" },
  failed: { icon: "x", label: "Failed" },
  running: { label: "Running" },
  queued: { icon: "clock", label: "Queued" },
};

export const statusPill = (status) => {
  if (!status) return html`<span class="pill">No runs yet</span>`;
  const s = STATUS[status];
  return html`<span class="pill ${status}">${status === "running" ? html`<span class="dot"></span>` : icon(s.icon)}${s.label}</span>`;
};

// Live-updating countdowns: any element with data-countdown="ISO".
setInterval(() => {
  for (const el of $$("[data-countdown]")) el.textContent = countdownText(el.dataset.countdown);
}, 1000);

// Animated number count-up for stat tiles.
export const countUp = (el, to, { format = (n) => Math.round(n).toLocaleString(), duration = 900 } = {}) => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(to * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export const toast = ({ title, message = "", type = "info", action, timeout = 5000 }) => {
  const root = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const iconName = type === "success" ? "check" : type === "error" ? "alert" : "info";
  el.innerHTML = html`
    <div class="t-icon">${icon(iconName)}</div>
    <div class="t-body">
      <div class="t-title">${title}</div>
      ${message ? html`<div class="t-msg">${message}</div>` : ""}
      ${action ? html`<div class="t-actions"><button class="btn sm" data-t-action>${action.label}</button></div>` : ""}
    </div>
    <button class="btn ghost sm icon-only" data-t-close aria-label="Dismiss">${icon("x")}</button>`.s;
  const close = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector("[data-t-close]").onclick = close;
  if (action) {
    el.querySelector("[data-t-action]").onclick = () => {
      action.onClick();
      close();
    };
  }
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
};

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
export const openModal = ({ title, description, iconName = "info", danger = false, body = "", actions, onMount }) =>
  new Promise((resolve) => {
    const root = $("#modal-root");
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = html`
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <div class="modal-icon ${danger ? "danger" : ""}">${icon(iconName)}</div>
          <div>
            <h2 id="modal-title">${title}</h2>
            ${description ? html`<p>${description}</p>` : ""}
          </div>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          ${actions.map(
            (a, i) => html`<button class="btn ${a.kind || ""}" data-i="${i}" ${a.submit ? raw('type="submit"') : raw('type="button"')}>${a.label}</button>`
          )}
        </div>
      </div>`.s;
    const previouslyFocused = document.activeElement;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      backdrop.classList.add("out");
      setTimeout(() => backdrop.remove(), 200);
      previouslyFocused?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close(null);
    });
    backdrop.querySelectorAll("[data-i]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = actions[Number(btn.dataset.i)];
        if (!action.onClick) return close(action.value ?? null);
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const result = await action.onClick(backdrop);
          if (result !== false) close(result ?? true);
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
      });
    });
    root.appendChild(backdrop);
    onMount?.(backdrop);
    (backdrop.querySelector("input, select, textarea") || backdrop.querySelector(".modal-foot .btn:last-child"))?.focus();
  });

export const confirmDialog = ({ title, description, confirmLabel = "Confirm", danger = false, iconName }) =>
  openModal({
    title,
    description,
    danger,
    iconName: iconName || (danger ? "trash" : "info"),
    actions: [
      { label: "Cancel", value: false },
      { label: confirmLabel, kind: danger ? "primary danger-solid" : "primary", value: true },
    ],
  }).then(Boolean);

// Sets a button into a loading state while an async function runs.
export const withLoading = async (btn, fn) => {
  const orig = btn.innerHTML;
  const width = btn.offsetWidth;
  btn.disabled = true;
  btn.style.minWidth = `${width}px`;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
    btn.style.minWidth = "";
  }
};

export const skeleton = (h, extra = "") => html`<div class="skeleton" style="height:${h}px;${extra}"></div>`;

export const emptyState = ({ iconName, title, text, action = "" }) => html`
  <div class="empty">
    <div class="empty-art">${icon(iconName)}</div>
    <h3>${title}</h3>
    <p>${text}</p>
    ${action}
  </div>`;
