import { api } from "../api.js";
import { $, html, icon, toast, withLoading, skeleton } from "../ui.js";

const statusRow = (ok, title, detail, extra = "") => html`
  <div class="status-line">
    <span class="pill ${ok ? "success" : "failed"}">${icon(ok ? "check" : "x")} ${ok ? "OK" : "Missing"}</span>
    <div class="grow"><div class="cell-main">${title}</div><div class="cell-sub mono">${detail}</div></div>
    ${extra}
  </div>`;

export const renderSettings = async ({ root, user }) => {
  root.innerHTML = html`
    <div class="page-head"><div><h1>Settings</h1><p>Your account and the server's configuration.</p></div></div>
    <div class="dash-grid stagger">
      <div class="card" style="--i:0">
        <div class="card-head"><h2>Change password</h2></div>
        <form class="card-pad stack" id="pw-form" novalidate>
          <div class="field"><label for="cur">Current password</label><input class="input" id="cur" type="password" autocomplete="current-password" /></div>
          <div class="field"><label for="new">New password</label><input class="input" id="new" type="password" autocomplete="new-password" minlength="8" /><span class="hint">At least 8 characters.</span></div>
          <div id="pw-msg"></div>
          <div><button class="btn primary" type="submit">${icon("lock")} Update password</button></div>
        </form>
      </div>
      <div class="card" style="--i:1">
        <div class="card-head"><h2>Profile</h2></div>
        <div class="card-pad kv">
          <div class="k">Name</div><div class="v">${user.name}</div>
          <div class="k">Email</div><div class="v">${user.email}</div>
          <div class="k">Role</div><div class="v">${user.role === "admin" ? "Administrator" : "User"}</div>
        </div>
      </div>
    </div>
    ${user.role === "admin"
      ? html`<div class="card" style="margin-top:16px">
          <div class="card-head"><h2>System status</h2><span class="faint" id="sys-version"></span></div>
          <div id="system">${skeleton(56, "margin:16px")}${skeleton(56, "margin:16px")}</div>
        </div>`
      : ""}`.s;

  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#pw-msg");
    try {
      await withLoading(e.target.querySelector("button"), () =>
        api.post("/auth/password", { currentPassword: $("#cur").value, newPassword: $("#new").value })
      );
      e.target.reset();
      msg.innerHTML = html`<div class="form-ok">${icon("check")} Password updated. Other sessions were signed out.</div>`.s;
    } catch (err) {
      msg.innerHTML = html`<div class="form-error">${icon("alert")} ${err.message}</div>`.s;
    }
  });

  if (user.role !== "admin") return;

  const sys = await api.get("/system");
  $("#sys-version").textContent = `v${sys.version} · ${sys.env}`;
  const pg = sys.tools.postgres;
  const my = sys.tools.mysql;
  $("#system").innerHTML = html`
    ${statusRow(Boolean(pg), "PostgreSQL dump tool", pg ? pg.version : "pg_dump not found — install postgresql-client or set PG_DUMP_PATH")}
    ${statusRow(Boolean(my), "MySQL dump tool", my ? my.version : "mysqldump not found — install mysql/mariadb client or set MYSQLDUMP_PATH")}
    ${statusRow(sys.storage.ok, `Storage (${sys.storage.driver})`, sys.storage.detail)}
    ${statusRow(
      sys.email.ready,
      `Email (${sys.email.provider})`,
      sys.email.provider === "console"
        ? "Emails are only printed to the server log. Set EMAIL_PROVIDER to smtp, brevo or resend."
        : sys.email.ready
          ? "Configured"
          : `Missing ${sys.email.missing}`,
      html`<button class="btn sm" id="test-email">${icon("send")} Send test</button>`
    )}
    ${statusRow(true, "Runner", `${sys.runner.active} running · ${sys.runner.queued} queued · max ${sys.runner.maxConcurrent} in parallel · timezone ${sys.timezone}`)}
    ${statusRow(!sys.appUrl.includes("localhost") || sys.env !== "production", "Public URL (used in emails)", sys.appUrl)}`.s;

  $("#test-email").onclick = async (e) => {
    try {
      const res = await withLoading(e.currentTarget, () => api.post("/system/test-email"));
      toast({ type: "success", title: "Test email sent", message: `Check ${res.to}` });
    } catch (err) {
      toast({ type: "error", title: "Email failed", message: err.message });
    }
  };
};
