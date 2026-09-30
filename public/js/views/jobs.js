import { api } from "../api.js";
import {
  html,
  icon,
  toast,
  confirmDialog,
  withLoading,
  engineBadge,
  scheduleText,
  statusPill,
  countdownText,
  timeAgo,
  skeleton,
  emptyState,
} from "../ui.js";

const jobCard = (job, i, isRunning, showOwner) => html`
  <article class="card job-card ${job.enabled ? "" : "disabled"} ${isRunning ? "is-running" : ""}" style="--i:${i}" data-id="${job.id}">
    <div class="job-top">
      ${engineBadge(job.dbType)}
      <div class="grow">
        <h3 title="${job.name}">${job.name}</h3>
        <div class="sub" title="${job.connection.database} @ ${job.connection.host}:${job.connection.port}">
          ${job.connection.database} @ ${job.connection.host}:${job.connection.port}
        </div>
      </div>
      <label class="switch" title="${job.enabled ? "Pause schedule" : "Resume schedule"}">
        <input type="checkbox" data-action="toggle" ${job.enabled ? "checked" : ""} aria-label="Schedule enabled" />
        <span class="track"></span>
      </label>
    </div>

    <div class="job-meta">
      <div><div class="k">Schedule</div><div class="v" title="${scheduleText(job)}">${scheduleText(job)}</div></div>
      <div>
        <div class="k">Next run</div>
        <div class="v">
          ${!job.enabled
            ? html`<span class="pill paused">${icon("pause")} Paused</span>`
            : job.nextRunAt
              ? html`<span class="countdown" data-countdown="${job.nextRunAt}">${countdownText(job.nextRunAt)}</span>`
              : html`<span class="faint">—</span>`}
        </div>
      </div>
      <div><div class="k">Last run</div><div class="v">${job.lastRunAt ? timeAgo(job.lastRunAt) : "Never"}</div></div>
      <div><div class="k">Status</div><div class="v">${isRunning ? statusPill("running") : statusPill(job.lastStatus)}</div></div>
    </div>

    <div class="job-actions">
      <button class="btn sm primary" data-action="run" ${isRunning ? "disabled" : ""}>${icon("play")} Run now</button>
      <a class="btn sm" href="#/dumps?job=${job.id}">${icon("archive")} Dumps</a>
      <span class="spacer"></span>
      ${showOwner ? html`<span class="tag" title="Owner">${job.ownerName || "—"}</span>` : ""}
      <a class="btn sm ghost icon-only" href="#/jobs/${job.id}/edit" title="Edit" aria-label="Edit job">${icon("edit")}</a>
      <button class="btn sm ghost icon-only danger" data-action="delete" title="Delete" aria-label="Delete job">${icon("trash")}</button>
    </div>
  </article>`;

export const renderJobs = async ({ root, user, onDump }) => {
  root.innerHTML = html`
    <div class="page-head">
      <div><h1>Backup jobs</h1><p>Connections and schedules for your PostgreSQL and MySQL databases.</p></div>
      <a class="btn primary" href="#/jobs/new">${icon("plus")} New backup job</a>
    </div>
    <div class="jobs-grid">${[0, 1, 2].map(() => skeleton(250))}</div>`.s;

  let jobs = [];
  const runningJobs = new Set();

  const paint = () => {
    const grid = html`
      <div class="page-head">
        <div><h1>Backup jobs</h1><p>Connections and schedules for your PostgreSQL and MySQL databases.</p></div>
        <a class="btn primary" href="#/jobs/new">${icon("plus")} New backup job</a>
      </div>
      ${jobs.length
        ? html`<div class="jobs-grid stagger">${jobs.map((j, i) => jobCard(j, i, runningJobs.has(j.id), user.role === "admin"))}</div>`
        : html`<div class="card">${emptyState({
            iconName: "database",
            title: "No backup jobs yet",
            text: "A job stores a database connection and when to dump it. Let's create your first one.",
            action: html`<a class="btn primary" href="#/jobs/new">${icon("plus")} Create a backup job</a>`,
          })}</div>`}`;
    root.innerHTML = grid.s;
  };

  // Re-render a single card in place (no grid-wide re-animation).
  const updateCard = (id) => {
    const job = jobs.find((j) => j.id === id);
    const el = root.querySelector(`.job-card[data-id="${id}"]`);
    if (!job || !el) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = jobCard(job, 0, runningJobs.has(id), user.role === "admin").s;
    tmp.firstElementChild.style.animation = "none";
    el.replaceWith(tmp.firstElementChild);
  };

  const load = async () => {
    const [{ jobs: list }, { dumps }] = await Promise.all([api.get("/jobs"), api.get("/dumps?limit=100")]);
    jobs = list;
    runningJobs.clear();
    dumps.filter((d) => d.status === "running" || d.status === "queued").forEach((d) => runningJobs.add(d.job));
    paint();
  };

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    const card = e.target.closest(".job-card");
    if (!btn || !card || btn.dataset.action === "toggle") return;
    const job = jobs.find((j) => j.id === card.dataset.id);

    if (btn.dataset.action === "run") {
      try {
        await withLoading(btn, () => api.post(`/jobs/${job.id}/run`));
        runningJobs.add(job.id);
        toast({ title: "Backup started", message: `${job.name} is being dumped. You'll be notified when it's done.` });
        updateCard(job.id);
      } catch (err) {
        toast({ type: "error", title: "Could not start", message: err.message });
      }
    }

    if (btn.dataset.action === "delete") {
      const ok = await confirmDialog({
        title: `Delete "${job.name}"?`,
        description: "The job and all of its stored dumps will be permanently removed. This cannot be undone.",
        confirmLabel: "Delete job",
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.del(`/jobs/${job.id}`);
        card.style.transition = "opacity .3s, transform .3s";
        card.style.opacity = "0";
        card.style.transform = "scale(.96)";
        setTimeout(() => {
          jobs = jobs.filter((j) => j.id !== job.id);
          paint();
        }, 280);
        toast({ type: "success", title: "Job deleted", message: `${res.deletedDumps} dump file(s) removed.` });
      } catch (err) {
        toast({ type: "error", title: "Delete failed", message: err.message });
      }
    }
  });

  root.addEventListener("change", async (e) => {
    if (e.target.dataset.action !== "toggle") return;
    const card = e.target.closest(".job-card");
    try {
      const { job } = await api.post(`/jobs/${card.dataset.id}/toggle`);
      jobs = jobs.map((j) => (j.id === job.id ? job : j));
      toast({ title: job.enabled ? "Schedule resumed" : "Schedule paused", message: job.name });
      updateCard(job.id);
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast({ type: "error", title: "Could not update", message: err.message });
    }
  });

  onDump((d) => {
    if (d.status === "running" || d.status === "queued") runningJobs.add(d.job);
    else {
      runningJobs.delete(d.job);
      const job = jobs.find((j) => j.id === d.job);
      if (job) {
        job.lastStatus = d.status;
        job.lastRunAt = d.finishedAt;
      }
    }
    updateCard(d.job);
  });

  await load();
};

