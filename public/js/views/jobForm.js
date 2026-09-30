import { api } from "../api.js";
import { $, $$, html, icon, raw, toast, withLoading, engineBadge, engineLabel, formatDate, skeleton } from "../ui.js";

const DEFAULT_PORTS = { postgres: 5432, mysql: 3306 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEPS = [
  { title: "Database engine", sub: "PostgreSQL or MySQL" },
  { title: "Connection", sub: "Host, credentials, database" },
  { title: "Schedule", sub: "When to take dumps" },
  { title: "Notify & review", sub: "Email, retention, save" },
];

const SCHEDULES = [
  ["manual", "On demand"],
  ["once", "One time"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["cron", "Custom cron"],
];

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Times are offered in 30-minute slots (HH:00 / HH:30).
const pad = (n) => String(n).padStart(2, "0");
const ALL_SLOTS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${pad((i % 2) * 30)}`);
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Earliest bookable slot: the next :00 or :30 strictly after now.
const nextSlot = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 30) * 30 + 30);
  return d;
};

// Slots still in the future for a given local date ("YYYY-MM-DD").
const slotsFor = (date) => {
  const first = nextSlot();
  const firstDate = localDate(first);
  if (date > firstDate) return ALL_SLOTS;
  if (date < firstDate) return [];
  return ALL_SLOTS.filter((t) => t >= localTime(first));
};

const timeLabel = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const slotOptions = (slots, selected) =>
  html`${slots.map((t) => html`<option value="${t}" ${t === selected ? raw("selected") : ""}>${timeLabel(t)}</option>`)}`;

const runAtDate = (f) => new Date(`${f.runDate}T${f.runTime}`);

const parseUri = (uri) => {
  const url = new URL(uri);
  const dbType = /^postgres(ql)?:$/.test(url.protocol) ? "postgres" : /^(mysql|mariadb):$/.test(url.protocol) ? "mysql" : null;
  return {
    dbType,
    host: url.hostname,
    port: url.port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")) || url.searchParams.get("ssl") === "true",
  };
};

const describeSchedule = (f) => {
  switch (f.scheduleType) {
    case "manual":
      return "Only when you click “Run now”";
    case "once":
      return f.runDate && f.runTime ? `Once on ${formatDate(runAtDate(f))}` : "Once (pick a date)";
    case "daily":
      return `Every day at ${timeLabel(f.time)}`;
    case "weekly":
      return f.daysOfWeek.length ? `Every ${f.daysOfWeek.map((d) => DAYS[d]).join(", ")} at ${timeLabel(f.time)}` : "Weekly (pick days)";
    case "cron":
      return `Cron “${f.cron}”`;
    default:
      return "";
  }
};

export const renderJobForm = async ({ root, user, params, navigate }) => {
  const editing = Boolean(params.id);
  root.innerHTML = html`<div class="page-head"><div><h1>${editing ? "Edit backup job" : "New backup job"}</h1></div></div>${skeleton(480)}`.s;

  const f = {
    name: "",
    dbType: "postgres",
    connMode: "fields",
    uri: "",
    host: "",
    port: "",
    username: "",
    password: "",
    database: "",
    ssl: false,
    hasPassword: false,
    scheduleType: "daily",
    runDate: localDate(nextSlot()),
    runTime: localTime(nextSlot()),
    time: "02:00",
    daysOfWeek: [1],
    cron: "0 2 * * *",
    timezone: browserTz(),
    notifyEmails: [user.email],
    notifyOn: "always",
    retention: 7,
    enabled: true,
  };
  let discovered = [];
  let testState = null; // { ok, text }
  let step = editing ? 1 : 0;
  let maxStep = editing ? 3 : 0;
  let direction = "forward";

  if (editing) {
    const { job } = await api.get(`/jobs/${params.id}`);
    const s = job.schedule;
    Object.assign(f, {
      name: job.name,
      dbType: job.dbType,
      host: job.connection.host,
      port: String(job.connection.port),
      username: job.connection.username,
      database: job.connection.database,
      ssl: job.connection.ssl,
      hasPassword: job.connection.hasPassword,
      scheduleType: s.type,
      time: s.time || f.time,
      daysOfWeek: s.daysOfWeek?.length ? s.daysOfWeek : f.daysOfWeek,
      cron: s.cron || f.cron,
      timezone: s.timezone,
      notifyEmails: job.notifyEmails,
      notifyOn: job.notifyOn,
      retention: job.retention,
      enabled: job.enabled,
    });
    // Keep a saved one-time run only if it is still in the future.
    if (s.runAt && new Date(s.runAt) > new Date()) {
      f.runDate = localDate(new Date(s.runAt));
      f.runTime = localTime(new Date(s.runAt));
    }
  }

  // -------------------------------------------------------------------------
  // Step panes
  // -------------------------------------------------------------------------
  const engineStep = () => html`
    <h2>Which database do you want to back up?</h2>
    <p>We'll use the native dump tool for the engine you choose.</p>
    <div class="engine-choice">
      ${["postgres", "mysql"].map(
        (t) => html`<button type="button" class="choice" data-engine="${t}" aria-pressed="${f.dbType === t}">
          <span class="check">${icon("check")}</span>
          ${engineBadge(t, "lg")}
          <div>
            <h3>${engineLabel(t)}</h3>
            <p>${t === "postgres" ? "Uses pg_dump. Works with Supabase, Neon, RDS, Render and self-hosted Postgres." : "Uses mysqldump. Works with MySQL 5.7+/8.x, MariaDB, PlanetScale-compatible and RDS."}</p>
          </div>
          <span class="tag">${t === "postgres" ? "pg_dump · port 5432" : "mysqldump · port 3306"}</span>
        </button>`
      )}
    </div>`;

  const connectionStep = () => html`
    <h2>Connect to ${engineLabel(f.dbType)}</h2>
    <p>Credentials are encrypted (AES-256-GCM) before being stored.</p>
    <div class="stack">
      <div class="segmented" role="group" aria-label="Connection input mode">
        <button type="button" data-conn-mode="fields" aria-pressed="${f.connMode === "fields"}">${icon("server")} Fields</button>
        <button type="button" data-conn-mode="uri" aria-pressed="${f.connMode === "uri"}">${icon("link")} Connection URI</button>
      </div>
      ${f.connMode === "uri"
        ? html`<div class="field">
            <label for="uri">Connection URI</label>
            <input class="input mono" id="uri" data-f="uri" value="${f.uri}" autocomplete="off" spellcheck="false"
              placeholder="${f.dbType === "postgres" ? "postgresql://user:password@host:5432/database?sslmode=require" : "mysql://user:password@host:3306/database"}" />
            <span class="hint">Paste the URI from your provider. It will be split into fields when saved.</span>
          </div>`
        : html`
          <div class="grid-3">
            <div class="field"><label for="host">Host</label><input class="input" id="host" data-f="host" value="${f.host}" placeholder="db.example.com" autocomplete="off" spellcheck="false" /></div>
            <div class="field"><label for="port">Port</label><input class="input" id="port" data-f="port" value="${f.port}" inputmode="numeric" placeholder="${DEFAULT_PORTS[f.dbType]}" /></div>
          </div>
          <div class="grid-2">
            <div class="field"><label for="username">Username</label><input class="input" id="username" data-f="username" value="${f.username}" autocomplete="off" spellcheck="false" /></div>
            <div class="field">
              <label for="dbpass">Password</label>
              <div class="input-wrap">
                <input class="input" id="dbpass" type="password" data-f="password" value="${f.password}" autocomplete="new-password"
                  placeholder="${editing && f.hasPassword ? "Saved — leave blank to keep" : ""}" />
                <button type="button" class="btn ghost" data-reveal="dbpass" aria-label="Show password">${icon("eye")}</button>
              </div>
            </div>
          </div>
          <div class="field">
            <label for="database">Database</label>
            <input class="input" id="database" data-f="database" value="${f.database}" list="db-list" autocomplete="off" spellcheck="false" placeholder="Test the connection to pick from a list" />
            <datalist id="db-list">${discovered.map((d) => html`<option value="${d}"></option>`)}</datalist>
            ${discovered.length
              ? html`<div class="row" style="margin-top:4px">${discovered.map(
                  (d) => html`<button type="button" class="btn sm ${d === f.database ? "primary" : ""}" data-pick-db="${d}">${icon("database")} ${d}</button>`
                )}</div>`
              : ""}
          </div>
          <label class="switch"><input type="checkbox" data-f="ssl" ${f.ssl ? "checked" : ""} /><span class="track"></span> Require SSL/TLS</label>`}
      <div class="test-result">
        <button type="button" class="btn" id="test-conn">${icon("plug")} Test connection</button>
        <span id="test-out">${testState
          ? testState.ok
            ? html`<span class="pill success">${icon("check")} ${testState.text}</span>`
            : html`<span class="pill failed">${icon("x")} Failed</span>`
          : ""}</span>
      </div>
      ${testState && !testState.ok ? html`<div class="form-error">${icon("alert")} <span class="mono">${testState.text}</span></div>` : ""}
    </div>`;

  const scheduleStep = () => html`
    <h2>When should it run?</h2>
    <p>Missed runs (e.g. while the server was asleep) are caught up automatically.</p>
    <div class="stack">
      <div class="segmented" role="group" aria-label="Schedule type">
        ${SCHEDULES.map(([v, label]) => html`<button type="button" data-schedule="${v}" aria-pressed="${f.scheduleType === v}">${label}</button>`)}
      </div>
      ${f.scheduleType === "manual"
        ? html`<div class="form-ok" style="background:var(--accent-soft);color:var(--text)">${icon("info")} No automatic runs. Use “Save & run now” or the Run button on the job.</div>`
        : ""}
      ${f.scheduleType === "once"
        ? html`<div class="grid-2" style="max-width:440px">
            <div class="field"><label for="runDate">Date</label><input class="input" type="date" id="runDate" data-f="runDate" min="${localDate(nextSlot())}" value="${f.runDate}" /></div>
            <div class="field"><label for="runTime">Time</label><select class="input" id="runTime" data-f="runTime">${slotOptions(slotsFor(f.runDate), f.runTime)}</select></div>
          </div>`
        : ""}
      ${f.scheduleType === "daily" || f.scheduleType === "weekly"
        ? html`<div class="field" style="max-width:200px"><label for="time">Time</label><select class="input" id="time" data-f="time">${slotOptions(ALL_SLOTS.includes(f.time) ? ALL_SLOTS : [f.time, ...ALL_SLOTS], f.time)}</select></div>`
        : ""}
      ${f.scheduleType === "weekly"
        ? html`<div class="field"><span class="label">Days</span><div class="days">${DAYS.map(
            (d, i) => html`<button type="button" class="day" data-day="${i}" aria-pressed="${f.daysOfWeek.includes(i)}">${d}</button>`
          )}</div></div>`
        : ""}
      ${f.scheduleType === "cron"
        ? html`<div class="field" style="max-width:360px">
            <label for="cron">Cron expression</label>
            <input class="input mono" id="cron" data-f="cron" value="${f.cron}" spellcheck="false" />
            <span class="hint">minute hour day-of-month month day-of-week — e.g. <code>0 */6 * * *</code> (every 6 hours). Minimum interval 5 minutes.</span>
          </div>`
        : ""}
      ${f.scheduleType !== "manual" && f.scheduleType !== "once"
        ? html`<div class="field" style="max-width:320px">
            <label for="timezone">Timezone</label>
            <select class="input" id="timezone" data-f="timezone">
              ${(Intl.supportedValuesOf?.("timeZone") || [f.timezone]).map(
                (tz) => html`<option value="${tz}" ${tz === f.timezone ? raw("selected") : ""}>${tz}</option>`
              )}
            </select>
          </div>`
        : ""}
      <div class="row faint">${icon("clock")} <span id="sched-desc">${describeSchedule(f)}</span></div>
    </div>`;

  const chipHtml = (e, i, isNew = false) =>
    html`<span class="chip ${isNew ? "new" : ""}">${e}<button type="button" data-remove-email="${i}" aria-label="Remove ${e}">${icon("x")}</button></span>`;

  // Updates the chips in place so the rest of the step doesn't re-render.
  const renderChips = (newIndex = -1) => {
    const box = $("#chips");
    const entry = $("#email-entry");
    if (!box || !entry) return;
    box.querySelectorAll(".chip").forEach((c) => c.remove());
    entry.insertAdjacentHTML("beforebegin", f.notifyEmails.map((e, i) => chipHtml(e, i, i === newIndex).s).join(""));
    entry.placeholder = f.notifyEmails.length ? "Add another…" : "name@company.com";
  };

  const notifyStep = () => html`
    <h2>Notifications & retention</h2>
    <p>Recipients get an email with a sign-in link to download the dump.</p>
    <div class="stack">
      <div class="field">
        <label for="name">Job name</label>
        <input class="input" id="name" data-f="name" value="${f.name}" placeholder="${f.database ? `${f.database} backup` : "Production backup"}" maxlength="80" />
      </div>
      <div class="field">
        <label for="email-entry">Notify these emails</label>
        <div class="chips-input" id="chips">
          ${f.notifyEmails.map((e, i) => chipHtml(e, i))}
          <input id="email-entry" type="email" placeholder="${f.notifyEmails.length ? "Add another…" : "name@company.com"}" autocomplete="off" />
        </div>
        <span class="hint">Press Enter or comma to add. Up to 10 addresses.</span>
      </div>
      <div class="field">
        <span class="label">Send email</span>
        <div class="segmented" role="group" aria-label="Notification policy">
          ${[["always", "Always"], ["failure", "Only on failure"], ["never", "Never"]].map(
            ([v, l]) => html`<button type="button" data-notify="${v}" aria-pressed="${f.notifyOn === v}">${l}</button>`
          )}
        </div>
      </div>
      <div class="field">
        <label for="retention">Keep the last <b id="ret-val">${f.retention}</b> successful dumps</label>
        <input class="range" type="range" id="retention" data-f="retention" min="1" max="60" value="${f.retention}" />
        <span class="hint">Older dump files are deleted automatically after each successful run.</span>
      </div>
      <label class="switch"><input type="checkbox" data-f="enabled" ${f.enabled ? "checked" : ""} /><span class="track"></span> Schedule enabled</label>

      <div class="review">
        <div><div class="k">Engine</div><div class="v">${engineLabel(f.dbType)}</div></div>
        <div><div class="k">Database</div><div class="v">${f.connMode === "uri" ? "From connection URI" : `${f.database || "—"} @ ${f.host || "—"}:${f.port || DEFAULT_PORTS[f.dbType]}`}</div></div>
        <div><div class="k">Schedule</div><div class="v">${describeSchedule(f)}${f.scheduleType !== "manual" && f.scheduleType !== "once" ? ` (${f.timezone})` : ""}</div></div>
        <div><div class="k">Output</div><div class="v">gzip-compressed .sql</div></div>
      </div>
    </div>`;

  const PANES = [engineStep, connectionStep, scheduleStep, notifyStep];

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------
  root.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>${editing ? "Edit backup job" : "New backup job"}</h1>
        <p>${editing ? "Update the connection, schedule or notifications." : "Four quick steps to automated backups."}</p>
      </div>
      <a class="btn ghost" href="#/jobs">${icon("chevronLeft")} Back to jobs</a>
    </div>
    <div class="wizard">
      <nav class="card steps" aria-label="Steps" id="steps"></nav>
      <form class="card wizard-panel" id="wizard" novalidate>
        <div class="wizard-body" id="pane"></div>
        <div id="step-error" style="padding:0 24px"></div>
        <div class="wizard-foot" id="foot"></div>
      </form>
    </div>`.s;

  const paintSteps = () => {
    $("#steps").innerHTML = html`
      <div class="progress-line"><span style="width:${(step / (STEPS.length - 1)) * 100}%"></span></div>
      ${STEPS.map(
        (s, i) => html`<button type="button" class="step ${i === step ? "current" : ""} ${i < step || (i <= maxStep && i !== step) ? "done" : ""}" data-goto="${i}" ${i > maxStep ? raw("disabled") : ""}>
          <span class="num">${i < step || (i <= maxStep && i !== step) ? icon("check") : i + 1}</span>
          <span class="step-text"><span class="step-title">${s.title}</span><br /><span class="step-sub">${s.sub}</span></span>
        </button>`
      )}`.s;
  };

  const paintFoot = () => {
    const last = step === STEPS.length - 1;
    $("#foot").innerHTML = html`
      ${step > 0 ? html`<button type="button" class="btn ghost" data-nav="back">${icon("chevronLeft")} Back</button>` : ""}
      <span class="spacer"></span>
      ${last
        ? html`<button type="button" class="btn" data-save="save">${icon("check")} ${editing ? "Save changes" : "Save job"}</button>
               <button type="button" class="btn primary" data-save="run">${icon("zap")} Save & run now</button>`
        : html`<button type="button" class="btn primary" data-nav="next">Continue ${icon("chevronRight")}</button>`}`.s;
  };

  const paintPane = (animate = false) => {
    const pane = $("#pane");
    const cls = animate ? `animate ${direction === "back" ? "back" : ""}` : "";
    pane.innerHTML = html`<div class="step-pane ${cls}">${PANES[step]()}</div>`.s;
    $("#step-error").innerHTML = "";
  };

  const paint = () => {
    paintSteps();
    paintPane(true);
    paintFoot();
  };

  const showError = (msg) => {
    $("#step-error").innerHTML = html`<div class="form-error" style="margin-bottom:16px">${icon("alert")} ${msg}</div>`.s;
  };

  // -------------------------------------------------------------------------
  // Validation + payload
  // -------------------------------------------------------------------------
  const validateStep = (i) => {
    if (i === 1) {
      if (f.connMode === "uri") {
        if (!f.uri.trim()) return "Paste a connection URI.";
        try {
          const p = parseUri(f.uri.trim());
          if (p.dbType && p.dbType !== f.dbType) return `That URI is for ${engineLabel(p.dbType)}, but you picked ${engineLabel(f.dbType)}.`;
          if (!p.database) return "The URI must include a database name (…/database).";
        } catch {
          return "That connection URI is not valid.";
        }
        return null;
      }
      if (!f.host.trim()) return "Enter the database host.";
      if (f.port && !/^\d+$/.test(f.port)) return "Port must be a number.";
      if (!f.username.trim()) return "Enter the username.";
      if (!f.database.trim()) return "Enter or pick the database to back up.";
    }
    if (i === 2) {
      if (f.scheduleType === "once" && (!f.runDate || !f.runTime || runAtDate(f) <= new Date())) {
        return "That time has already passed. Pick a later date or time.";
      }
      if (f.scheduleType === "weekly" && !f.daysOfWeek.length) return "Pick at least one day.";
      if (f.scheduleType === "cron" && f.cron.trim().split(/\s+/).length < 5) return "A cron expression needs 5 fields.";
    }
    if (i === 3) {
      flushEmailEntry();
      if (f.notifyEmails.some((e) => !EMAIL_RE.test(e))) return "One of the emails is not valid.";
    }
    return null;
  };

  const connectionPayload = () => {
    if (f.connMode === "uri") return { uri: f.uri.trim() };
    const c = { host: f.host.trim(), username: f.username.trim(), database: f.database.trim(), ssl: f.ssl };
    if (f.port) c.port = Number(f.port);
    if (f.password) c.password = f.password;
    return c;
  };

  const payload = (runNow) => ({
    name: f.name.trim() || (f.database ? `${f.database} backup` : `${engineLabel(f.dbType)} backup`),
    dbType: f.dbType,
    connection: connectionPayload(),
    schedule: {
      type: f.scheduleType,
      runAt: f.scheduleType === "once" ? runAtDate(f).toISOString() : undefined,
      time: f.time,
      daysOfWeek: f.daysOfWeek,
      cron: f.cron.trim(),
      timezone: f.timezone,
    },
    notifyEmails: f.notifyEmails,
    notifyOn: f.notifyOn,
    retention: Number(f.retention),
    enabled: f.enabled,
    runNow,
  });

  const goTo = (i) => {
    if (i > step) {
      for (let s = step; s < i; s++) {
        const err = validateStep(s);
        if (err) {
          showError(err);
          return;
        }
      }
    }
    direction = i < step ? "back" : "forward";
    step = i;
    maxStep = Math.max(maxStep, step);
    paint();
    $("#pane input, #pane select, #pane .choice")?.focus({ preventScroll: true });
  };

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  const form = $("#wizard");

  const onField = (e) => {
    const key = e.target.dataset.f;
    if (!key) return;
    if (key === "runDate") {
      // Wait for a complete date (change event); never allow a past day.
      if (e.type !== "change") return;
      const minDate = localDate(nextSlot());
      if (!e.target.value || e.target.value < minDate) e.target.value = minDate;
      f.runDate = e.target.value;
      const slots = slotsFor(f.runDate);
      if (!slots.includes(f.runTime)) f.runTime = slots[0];
      $("#runTime").innerHTML = slotOptions(slots, f.runTime).s;
      $("#sched-desc").textContent = describeSchedule(f);
      return;
    }
    f[key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (key === "retention") $("#ret-val").textContent = f.retention;
    if (["runTime", "time", "cron"].includes(key) && $("#sched-desc")) $("#sched-desc").textContent = describeSchedule(f);
    if (["host", "port", "username", "password", "uri", "ssl"].includes(key) && testState) {
      testState = null;
      $("#test-out").innerHTML = "";
    }
  };
  form.addEventListener("input", onField);
  form.addEventListener("change", onField);

  const flushEmailEntry = () => {
    const entry = $("#email-entry");
    if (!entry) return;
    const values = entry.value.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
    for (const v of values) {
      if (!EMAIL_RE.test(v)) {
        showError(`“${v}” is not a valid email.`);
        return;
      }
      if (!f.notifyEmails.includes(v) && f.notifyEmails.length < 10) f.notifyEmails.push(v);
    }
    if (values.length) {
      entry.value = "";
      renderChips(f.notifyEmails.length - 1);
      entry.focus();
    }
  };

  form.addEventListener("keydown", (e) => {
    if (e.target.id === "email-entry") {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        flushEmailEntry();
      } else if (e.key === "Backspace" && !e.target.value && f.notifyEmails.length) {
        f.notifyEmails.pop();
        renderChips();
      }
      return;
    }
    if (e.key === "Enter" && e.target.tagName === "INPUT") {
      e.preventDefault();
      if (step < STEPS.length - 1) goTo(step + 1);
    }
  });

  form.addEventListener("focusout", (e) => {
    if (e.target.id === "email-entry" && e.target.value.trim()) flushEmailEntry();
  });

  form.addEventListener("click", async (e) => {
    const t = e.target.closest("button, .chips-input");
    if (!t) return;
    if (t.id === "chips" && e.target === t) return $("#email-entry").focus();

    if (t.dataset.engine) {
      if (f.dbType !== t.dataset.engine) {
        f.dbType = t.dataset.engine;
        discovered = [];
        testState = null;
      }
      $$(".choice").forEach((c) => c.setAttribute("aria-pressed", String(c === t)));
      setTimeout(() => goTo(1), 220);
    }
    if (t.dataset.connMode) {
      if (t.dataset.connMode === "fields" && f.connMode === "uri" && f.uri.trim()) {
        try {
          const p = parseUri(f.uri.trim());
          Object.assign(f, { host: p.host, port: p.port, username: p.username, password: p.password, database: p.database, ssl: p.ssl });
        } catch {
          /* keep existing fields */
        }
      }
      f.connMode = t.dataset.connMode;
      paintPane();
    }
    if (t.dataset.reveal) {
      const input = $(`#${t.dataset.reveal}`);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      t.innerHTML = icon(show ? "eyeOff" : "eye").s;
    }
    if (t.dataset.pickDb) {
      f.database = t.dataset.pickDb;
      paintPane();
    }
    if (t.id === "test-conn") {
      try {
        const res = await withLoading(t, () =>
          api.post("/jobs/test-connection", { dbType: f.dbType, connection: connectionPayload(), jobId: params.id })
        );
        testState = { ok: true, text: res.version };
        discovered = res.databases || [];
        if (f.connMode === "uri") {
          const p = parseUri(f.uri.trim());
          Object.assign(f, { host: p.host, port: p.port, username: p.username, password: p.password, database: p.database, ssl: p.ssl });
        }
        if (!f.database && discovered.length === 1) f.database = discovered[0];
      } catch (err) {
        testState = { ok: false, text: err.message };
      }
      paintPane();
    }
    if (t.dataset.schedule) {
      f.scheduleType = t.dataset.schedule;
      paintPane();
    }
    if (t.dataset.day) {
      const d = Number(t.dataset.day);
      f.daysOfWeek = f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d].sort();
      t.setAttribute("aria-pressed", String(f.daysOfWeek.includes(d)));
      $("#sched-desc").textContent = describeSchedule(f);
    }
    if (t.dataset.notify) {
      f.notifyOn = t.dataset.notify;
      $$("[data-notify]").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
    }
    if (t.dataset.removeEmail) {
      f.notifyEmails.splice(Number(t.dataset.removeEmail), 1);
      renderChips();
      $("#email-entry").focus();
    }
  });

  $("#steps").addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto]");
    if (b && !b.disabled) goTo(Number(b.dataset.goto));
  });

  $("#foot").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.nav === "back") goTo(step - 1);
    if (b.dataset.nav === "next") goTo(step + 1);
    if (b.dataset.save) {
      for (let s = 1; s < STEPS.length; s++) {
        const err = validateStep(s);
        if (err) {
          if (s !== step) goTo(s);
          showError(err);
          return;
        }
      }
      try {
        const body = payload(b.dataset.save === "run");
        const { job } = await withLoading(b, () => (editing ? api.put(`/jobs/${params.id}`, body) : api.post("/jobs", body)));
        toast({
          type: "success",
          title: editing ? "Job updated" : "Backup job created",
          message: body.runNow
            ? "The first dump is running now. You'll get a notification when it finishes."
            : job.nextRunAt
              ? `Next run: ${formatDate(job.nextRunAt)}`
              : "Run it any time from the jobs page.",
        });
        navigate(body.runNow ? "/dumps" : "/jobs");
      } catch (err) {
        showError(err.message);
      }
    }
  });

  paint();
};
