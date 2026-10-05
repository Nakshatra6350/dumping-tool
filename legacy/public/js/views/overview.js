import { api } from "../api.js";
import {
  $,
  html,
  icon,
  countUp,
  formatBytes,
  formatDate,
  timeAgo,
  countdownText,
  engineBadge,
  scheduleText,
  statusPill,
  skeleton,
  emptyState,
} from "../ui.js";

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

// Stacked bar chart of successful vs failed dumps per day (status colors,
// always paired with a legend + tooltip + table so color is never alone).
const activityChart = (series) => {
  const W = 640;
  const H = 240;
  const pad = { t: 12, r: 8, b: 28, l: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(4, ...series.map((d) => d.success + d.failed));
  const niceMax = Math.ceil(max / 4) * 4;
  const y = (v) => pad.t + innerH - (v / niceMax) * innerH;
  const slot = innerW / series.length;
  const bw = Math.min(26, slot * 0.56);
  const ticks = [0, 1, 2, 3, 4].map((i) => (niceMax / 4) * i);
  // Rounded top on the outermost segment only, anchored flat on the baseline.
  const barPath = (x, y0, y1, roundTop) => {
    const h = y0 - y1;
    if (h <= 0) return "";
    const r = roundTop ? Math.min(4, h, bw / 2) : 0;
    return `M${x},${y0}V${y1 + r}${r ? `Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}` : `H${x + bw}`}V${y0}Z`;
  };

  return html`
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Dumps per day over the last 14 days">
      <g class="grid">${ticks.map((t) => html`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"></line>`)}</g>
      <g class="axis">${ticks.map((t) => html`<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`)}</g>
      <g class="bars">
        ${series.map((d, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2;
          const base = y(0);
          const ys = y(d.success);
          // 2px surface gap between stacked segments.
          const yf = y(d.success + d.failed);
          const gap = d.success && d.failed ? 2 : 0;
          return html`<g class="col" data-i="${i}" style="--i:${i}">
            <rect class="hover-band" x="${pad.l + slot * i + 2}" y="${pad.t}" width="${slot - 4}" height="${innerH}" rx="6"></rect>
            <path class="bar-success" d="${barPath(x, base, ys, !d.failed)}"></path>
            <path class="bar-failed" d="${barPath(x, ys - gap, yf, true)}"></path>
            <rect class="hit" x="${pad.l + slot * i}" y="${pad.t}" width="${slot}" height="${innerH + 4}"></rect>
          </g>`;
        })}
      </g>
      <line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"></line>
      <g class="axis">
        ${series.map((d, i) =>
          (series.length - 1 - i) % 2 === 0
            ? html`<text x="${pad.l + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle">${dayLabel(d.day)}</text>`
            : ""
        )}
      </g>
    </svg>`;
};

const statTile = (i, iconName, label, id, sub) => html`
  <div class="card stat" style="--i:${i}">
    <div class="stat-label"><span class="icon-bubble">${icon(iconName)}</span>${label}</div>
    <div class="value" id="${id}">0</div>
    <div class="sub">${sub}</div>
  </div>`;

export const renderOverview = async ({ root, user, onDump }) => {
  root.innerHTML = html`
    <div class="page-head">
      <div>
        <h1>Hello, ${user.name.split(" ")[0]} 👋</h1>
        <p>Here's what is happening with your database backups.</p>
      </div>
      <a class="btn primary" href="#/jobs/new">${icon("plus")} New backup job</a>
    </div>
    <div class="bento">${[0, 1, 2, 3].map(() => skeleton(118))}</div>
    <div class="dash-grid">${skeleton(330)}${skeleton(330)}</div>`.s;

  let timer;
  const load = async () => {
    const s = await api.get("/stats");
    const rate = s.dumps.successRate;
    const circumference = 2 * Math.PI * 31;
    const nextJob = s.upcoming[0];

    root.innerHTML = html`
      <div class="page-head">
        <div>
          <h1>Hello, ${user.name.split(" ")[0]} 👋</h1>
          <p>Here's what is happening with your database backups.</p>
        </div>
        <a class="btn primary" href="#/jobs/new">${icon("plus")} New backup job</a>
      </div>

      <div class="bento stagger">
        ${statTile(0, "calendar", "Backup jobs", "st-jobs", html`${s.jobs.active} active · ${s.jobs.total - s.jobs.active} paused`)}
        <div class="card stat ring-stat" style="--i:1">
          <div>
            <div class="stat-label"><span class="icon-bubble">${icon("check")}</span>Success rate</div>
            <div class="value" id="st-rate">${rate === null ? "—" : "0%"}</div>
            <div class="sub">${s.dumps.success} succeeded · ${s.dumps.failed} failed</div>
          </div>
          <svg class="ring" viewBox="0 0 78 78" aria-hidden="true">
            <circle class="track" cx="39" cy="39" r="31"></circle>
            <circle class="bar" id="ring-bar" cx="39" cy="39" r="31" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"></circle>
          </svg>
        </div>
        ${statTile(2, "hardDrive", "Stored dumps", "st-bytes", html`${s.dumps.success} files kept by retention`)}
        <div class="card stat" style="--i:3">
          <div class="stat-label"><span class="icon-bubble">${icon("clock")}</span>Next backup</div>
          <div class="value" style="font-size:22px;margin-top:16px">
            ${nextJob ? html`<span class="countdown" style="font-size:22px" data-countdown="${nextJob.nextRunAt}">${countdownText(nextJob.nextRunAt)}</span>` : html`<span class="faint">Nothing scheduled</span>`}
          </div>
          <div class="sub">${nextJob ? `${nextJob.name} · ${formatDate(nextJob.nextRunAt)}` : "Create a job to get started"}</div>
        </div>
      </div>

      <div class="dash-grid stagger">
        <div class="card" style="--i:4">
          <div class="card-head">
            <h2>Backup activity <span class="faint" style="font-weight:500">· last 14 days</span></h2>
            <div class="legend">
              <span><i style="background:var(--good)"></i>${icon("check")} Succeeded</span>
              <span><i style="background:var(--critical)"></i>${icon("x")} Failed</span>
            </div>
          </div>
          <div class="chart-wrap chart" id="chart">
            ${activityChart(s.series)}
            <div class="tooltip" id="chart-tip"></div>
          </div>
          <details style="padding:0 20px 16px">
            <summary class="faint" style="cursor:pointer;font-size:12.5px">View as table</summary>
            <table class="table" style="margin-top:8px">
              <thead><tr><th>Day</th><th class="num">Succeeded</th><th class="num">Failed</th></tr></thead>
              <tbody>${s.series.map((d) => html`<tr><td data-label="Day">${dayLabel(d.day)}</td><td class="num" data-label="Succeeded">${d.success}</td><td class="num" data-label="Failed">${d.failed}</td></tr>`)}</tbody>
            </table>
          </details>
        </div>

        <div class="card" style="--i:5">
          <div class="card-head"><h2>Upcoming</h2><a class="btn ghost sm" href="#/jobs">All jobs ${icon("chevronRight")}</a></div>
          ${s.upcoming.length
            ? html`<div class="list">
                ${s.upcoming.map(
                  (j) => html`<a class="list-item" href="#/jobs/${j.id}/edit" style="color:inherit">
                    ${engineBadge(j.dbType)}
                    <div class="grow"><div class="title">${j.name}</div><div class="sub">${scheduleText(j)}</div></div>
                    <span class="countdown" data-countdown="${j.nextRunAt}">${countdownText(j.nextRunAt)}</span>
                  </a>`
                )}
              </div>`
            : emptyState({ iconName: "calendar", title: "No scheduled runs", text: "Scheduled jobs will show up here with a live countdown." })}
        </div>
      </div>

      <div class="card stagger" style="margin-top:16px">
        <div class="card-head"><h2>Recent dumps</h2><a class="btn ghost sm" href="#/dumps">View all ${icon("chevronRight")}</a></div>
        <div id="recent">
          ${s.recent.length
            ? html`<div class="list">
                ${s.recent.map(
                  (d, i) => html`<div class="list-item" style="--i:${i}">
                    ${engineBadge(d.dbType)}
                    <div class="grow"><div class="title">${d.jobName}</div><div class="sub">${d.database} @ ${d.host} · ${timeAgo(d.createdAt)}</div></div>
                    ${statusPill(d.status)}
                    ${d.downloadable
                      ? html`<a class="btn sm icon-only" href="/api/dumps/${d.id}/download" title="Download ${d.fileName}" aria-label="Download">${icon("download")}</a>`
                      : ""}
                  </div>`
                )}
              </div>`
            : emptyState({
                iconName: "database",
                title: "No dumps yet",
                text: "Create your first backup job and run it. Finished dumps appear here.",
                action: html`<a class="btn primary" href="#/jobs/new">${icon("plus")} Create a backup job</a>`,
              })}
        </div>
      </div>`.s;

    countUp($("#st-jobs"), s.jobs.total);
    countUp($("#st-bytes"), s.dumps.storedBytes, { format: formatBytes });
    if (rate !== null) {
      countUp($("#st-rate"), rate * 100, { format: (n) => `${Math.round(n)}%` });
      requestAnimationFrame(() => ($("#ring-bar").style.strokeDashoffset = String(circumference * (1 - rate))));
    }
    wireChart(s.series);
  };

  const wireChart = (series) => {
    const wrap = $("#chart");
    const tip = $("#chart-tip");
    wrap.querySelectorAll(".col").forEach((col) => {
      const d = series[Number(col.dataset.i)];
      col.addEventListener("mouseenter", () => {
        tip.innerHTML = html`<div class="t-title">${dayLabel(d.day)}</div>
          <div class="t-row"><span>${icon("check")} Succeeded</span><b>${d.success}</b></div>
          <div class="t-row"><span>${icon("x")} Failed</span><b>${d.failed}</b></div>`.s;
        tip.classList.add("show");
      });
      col.addEventListener("mousemove", (e) => {
        const r = wrap.getBoundingClientRect();
        const x = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 4);
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(0, e.clientY - r.top - tip.offsetHeight - 10)}px`;
      });
      col.addEventListener("mouseleave", () => tip.classList.remove("show"));
    });
  };

  await load();
  // Refresh when a dump finishes (debounced).
  onDump((d) => {
    if (d.status === "success" || d.status === "failed") {
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    }
  });
  return () => clearTimeout(timer);
};
