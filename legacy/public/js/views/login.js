import { api } from "../api.js";
import { $, html, icon, withLoading } from "../ui.js";

const POINTS = [
  ["calendar", "Schedule anything", "Once, daily, weekly or custom cron, in your timezone."],
  ["mail", "Get notified", "Email lands the moment a dump finishes or fails."],
  ["shield", "Secure by default", "Encrypted credentials, private downloads, per-user access."],
];

export const renderLogin = (root, { onLogin }) => {
  document.title = "Sign in · Dumping Tool";
  root.innerHTML = html`
    <div class="login">
      <section class="login-hero" aria-hidden="true">
        <div class="hero-grid"></div>
        <div class="blob b1"></div>
        <div class="blob b2"></div>
        <div class="blob b3"></div>
        <div class="brand hero-content"><span class="logo-mark"></span> Dumping Tool</div>
        <div class="hero-content">
          <h2 class="hero-title">Database backups on <span class="gradient-text">autopilot.</span></h2>
          <p class="muted">Point it at PostgreSQL or MySQL, pick a schedule, and download compressed dumps whenever you need them.</p>
          <ul class="hero-points">
            ${POINTS.map(
              ([ic, t, d], i) => html`<li style="--i:${i}"><span class="icon-bubble">${icon(ic)}</span><div><strong>${t}</strong>${d}</div></li>`
            )}
          </ul>
        </div>
        <div class="terminal">
          <div class="dots"><span></span><span></span><span></span></div>
          <div class="line" style="--i:0"><span class="dim">$</span> pg_dump shop | gzip</div>
          <div class="line" style="--i:1"><span class="ok">✔</span> postgres_shop_2026-09-30.sql.gz <span class="dim">(18.4 MB)</span></div>
          <div class="line" style="--i:2"><span class="ok">✔</span> email sent to ops@company.com</div>
          <div class="line caret" style="--i:3"><span class="dim">next run in 23h 59m</span></div>
        </div>
      </section>

      <section class="login-panel">
        <form class="login-card" id="login-form" novalidate>
          <div class="brand"><span class="logo-mark"></span> Dumping Tool</div>
          <h1>Welcome back</h1>
          <p class="muted" style="margin:0 0 26px">Sign in to manage your database backups.</p>
          <div class="stack">
            <div class="field">
              <label for="email">Email</label>
              <div class="input-icon">${icon("mail")}<input class="input" id="email" name="email" type="email" autocomplete="username" required autofocus /></div>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <div class="input-wrap input-icon">
                ${icon("lock")}
                <input class="input" id="password" name="password" type="password" autocomplete="current-password" required />
                <button type="button" class="btn ghost" id="reveal" aria-label="Show password">${icon("eye")}</button>
              </div>
            </div>
            <div id="login-error"></div>
            <button class="btn primary block" type="submit" style="height:42px">Sign in ${icon("chevronRight")}</button>
          </div>
          <p class="faint" style="margin-top:22px;font-size:12.5px">Accounts are created by an administrator.</p>
        </form>
      </section>
    </div>`.s;

  const form = $("#login-form");
  const pw = $("#password");
  $("#reveal").onclick = (e) => {
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    e.currentTarget.innerHTML = icon(show ? "eyeOff" : "eye").s;
    e.currentTarget.setAttribute("aria-label", show ? "Hide password" : "Show password");
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorBox = $("#login-error");
    errorBox.innerHTML = "";
    const email = $("#email").value.trim();
    if (!email || !pw.value) {
      errorBox.innerHTML = html`<div class="form-error">${icon("alert")} Enter your email and password.</div>`.s;
      return;
    }
    try {
      const { user } = await withLoading(form.querySelector('[type="submit"]'), () =>
        api.post("/auth/login", { email, password: pw.value })
      );
      onLogin(user);
    } catch (err) {
      errorBox.innerHTML = html`<div class="form-error">${icon("alert")} ${err.message}</div>`.s;
      form.classList.remove("shake");
      void form.offsetWidth;
      form.classList.add("shake");
      pw.select();
    }
  });
};
