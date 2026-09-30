import { api, setUnauthorizedHandler } from "./api.js";
import { $, html, icon, initials, toast } from "./ui.js";
import { renderLogin } from "./views/login.js";
import { renderOverview } from "./views/overview.js";
import { renderJobs } from "./views/jobs.js";
import { renderJobForm } from "./views/jobForm.js";
import { renderDumps } from "./views/dumps.js";
import { renderUsers } from "./views/users.js";
import { renderSettings } from "./views/settings.js";

const state = { user: null, events: null, live: false };
const dumpListeners = new Set();
let cleanup = null;

// ---------------------------------------------------------------------------
// Routing (hash based: #/path?query)
// ---------------------------------------------------------------------------
const ROUTES = [
  { re: /^\/?$/, view: renderOverview, title: "Overview", nav: "overview" },
  { re: /^\/jobs$/, view: renderJobs, title: "Backup jobs", nav: "jobs" },
  { re: /^\/jobs\/new$/, view: renderJobForm, title: "New backup job", nav: "jobs" },
  { re: /^\/jobs\/([a-f0-9]{24})\/edit$/, view: renderJobForm, title: "Edit backup job", nav: "jobs", param: "id" },
  { re: /^\/dumps$/, view: renderDumps, title: "Dumps", nav: "dumps" },
  { re: /^\/users$/, view: renderUsers, title: "Users", nav: "users", admin: true },
  { re: /^\/settings$/, view: renderSettings, title: "Settings", nav: "settings" },
];

export const navigate = (path) => {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
};

const parseHash = () => {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
};

const route = async () => {
  cleanup?.();
  cleanup = null;
  dumpListeners.clear();

  if (!state.user) {
    stopEvents();
    renderLogin($("#app"), { onLogin });
    return;
  }

  const { path, query } = parseHash();
  let match;
  const r = ROUTES.find((x) => (match = x.re.exec(path)));
  if (!r || (r.admin && state.user.role !== "admin")) {
    navigate("/");
    return;
  }

  ensureShell();
  document.title = `${r.title} · Dumping Tool`;
  $("#crumb-title").textContent = r.title;
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === r.nav));
  $(".shell").classList.remove("nav-open");

  // Fresh element per route: drops the previous view's listeners and
  // restarts the enter animation.
  const old = $("#view");
  const root = document.createElement("div");
  root.id = "view";
  root.className = "view";
  old.replaceWith(root);
  window.scrollTo({ top: 0 });

  const ctx = {
    root,
    user: state.user,
    query,
    params: r.param ? { [r.param]: match[1] } : {},
    navigate,
    onDump: (fn) => dumpListeners.add(fn),
  };
  try {
    cleanup = (await r.view(ctx)) || null;
  } catch (err) {
    root.innerHTML = html`<div class="card card-pad"><div class="form-error">${icon("alert")} ${err.message}</div></div>`.s;
  }
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const navLink = (href, nav, iconName, label) =>
  html`<a href="#${href}" data-nav="${nav}">${icon(iconName)}<span>${label}</span>${nav === "dumps" ? html`<span class="count" id="running-count" hidden></span>` : ""}</a>`;

const ensureShell = () => {
  if ($(".shell")) return;
  const u = state.user;
  $("#app").innerHTML = html`
    <div class="shell">
      <aside class="sidebar" aria-label="Main navigation">
        <div class="brand"><span class="logo-mark"></span> Dumping Tool</div>
        <nav class="nav">
          ${navLink("/", "overview", "dashboard", "Overview")}
          ${navLink("/jobs", "jobs", "calendar", "Backup jobs")}
          ${navLink("/dumps", "dumps", "archive", "Dumps")}
          <div class="nav-label">Account</div>
          ${u.role === "admin" ? navLink("/users", "users", "users", "Users") : ""}
          ${navLink("/settings", "settings", "settings", "Settings")}
        </nav>
        <div class="sidebar-footer">
          <a class="btn primary block" href="#/jobs/new">${icon("plus")} New backup job</a>
          <div class="user-chip">
            <span class="avatar">${initials(u.name)}</span>
            <div class="meta">
              <div class="name">${u.name}</div>
              <div class="email">${u.email}</div>
            </div>
            <button class="btn ghost sm icon-only" id="logout" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
          </div>
        </div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="topbar">
          <button class="btn ghost icon-only menu-btn" id="menu" aria-label="Open navigation">${icon("menu")}</button>
          <div class="crumbs"><span class="crumb-root">Dumping Tool ${icon("chevronRight")}</span> <strong id="crumb-title"></strong></div>
          <div class="spacer"></div>
          <span class="live-dot" id="live" title="Live updates"><span>Live</span></span>
          <button class="btn ghost icon-only" id="theme" aria-label="Toggle theme"></button>
        </header>
        <main class="content"><div id="view"></div></main>
      </div>
    </div>`.s;

  $("#logout").onclick = async () => {
    await api.post("/auth/logout").catch(() => {});
    state.user = null;
    location.hash = "/";
    route();
  };
  $("#menu").onclick = () => $(".shell").classList.add("nav-open");
  $("#scrim").onclick = () => $(".shell").classList.remove("nav-open");
  $("#theme").onclick = toggleTheme;
  paintThemeButton();
  startEvents();
  refreshRunningCount();
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const toggleTheme = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("dt-theme", next);
  } catch {
    /* storage unavailable */
  }
  paintThemeButton();
};

const paintThemeButton = () => {
  const btn = $("#theme");
  if (!btn) return;
  const dark = document.documentElement.dataset.theme === "dark";
  btn.innerHTML = icon(dark ? "sun" : "moon").s;
  btn.title = dark ? "Switch to light theme" : "Switch to dark theme";
};

// ---------------------------------------------------------------------------
// Live updates (server-sent events)
// ---------------------------------------------------------------------------
const running = new Map();

const refreshRunningCount = async () => {
  try {
    const { dumps } = await api.get("/dumps?limit=50");
    running.clear();
    dumps.filter((d) => d.status === "running" || d.status === "queued").forEach((d) => running.set(d.id, d));
  } catch {
    /* ignore */
  }
  paintRunningCount();
};

const paintRunningCount = () => {
  const el = $("#running-count");
  if (!el) return;
  el.hidden = running.size === 0;
  el.textContent = running.size;
};

const setLive = (on) => {
  state.live = on;
  $("#live")?.classList.toggle("on", on);
};

const startEvents = () => {
  if (state.events) return;
  const es = new EventSource("/api/dumps/events");
  state.events = es;
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);
  es.addEventListener("dump", (e) => {
    const dump = JSON.parse(e.data);
    const wasTracked = running.has(dump.id);
    if (dump.status === "running" || dump.status === "queued") running.set(dump.id, dump);
    else running.delete(dump.id);
    paintRunningCount();

    if (wasTracked && dump.status === "success") {
      toast({
        type: "success",
        title: "Backup ready",
        message: `${dump.jobName} · ${dump.database}`,
        action: { label: "Download", onClick: () => (location.href = `/api/dumps/${dump.id}/download`) },
        timeout: 8000,
      });
    } else if (wasTracked && dump.status === "failed") {
      toast({ type: "error", title: "Backup failed", message: `${dump.jobName}: ${dump.error || "unknown error"}`, timeout: 10000 });
    }
    dumpListeners.forEach((fn) => fn(dump, "update"));
  });
  es.addEventListener("dump-deleted", (e) => {
    const d = JSON.parse(e.data);
    dumpListeners.forEach((fn) => fn(d, "deleted"));
  });
};

const stopEvents = () => {
  state.events?.close();
  state.events = null;
  running.clear();
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const onLogin = (user) => {
  state.user = user;
  $("#app").innerHTML = "";
  route();
};

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  toast({ type: "error", title: "Session expired", message: "Please sign in again." });
  route();
});

window.addEventListener("hashchange", route);

(async () => {
  try {
    const { user } = await api.get("/auth/me");
    state.user = user;
  } catch {
    state.user = null;
  }
  route();
})();
