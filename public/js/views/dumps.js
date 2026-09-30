import { api } from "../api.js";
import {
  $,
  html,
  icon,
  toast,
  confirmDialog,
  engineBadge,
  statusPill,
  formatBytes,
  formatDuration,
  formatDate,
  timeAgo,
  skeleton,
  emptyState,
} from "../ui.js";

const FILTERS = [
  ["", "All"],
  ["success", "Succeeded"],
  ["failed", "Failed"],
  ["running", "Running"],
];

const row = (d, i) => html`
  <tr data-id="${d.id}" style="--i:${Math.min(i, 15)}">
    <td class="primary-cell">
      <div class="row" style="flex-wrap:nowrap">
        ${engineBadge(d.dbType)}
        <div style="min-width:0">
          <div class="cell-main">${d.jobName || "Deleted job"}</div>
          <div class="cell-sub">${d.database} @ ${d.host}</div>
          ${d.status === "failed" && d.error ? html`<div class="error-text">${d.error}</div>` : ""}
        </div>
      </div>
    </td>
    <td data-label="Status">
      ${statusPill(d.status)}
      ${d.status === "running" ? html`<div class="indeterminate"></div>` : ""}
    </td>
    <td data-label="Started"><span title="${formatDate(d.createdAt)}">${timeAgo(d.createdAt)}</span><div class="cell-sub">${d.trigger === "schedule" ? "Scheduled" : "Manual"}</div></td>
    <td class="num" data-label="Duration">${d.status === "success" || d.status === "failed" ? formatDuration(d.durationMs) : "—"}</td>
    <td class="num" data-label="Size">${d.sizeBytes ? formatBytes(d.sizeBytes) : "—"}</td>
    <td class="actions">
      ${d.downloadable
        ? html`<a class="btn sm primary" href="/api/dumps/${d.id}/download" title="${d.fileName}${d.sha256 ? `\nSHA-256: ${d.sha256}` : ""}">${icon("download")} Download</a>`
        : ""}
      ${d.status === "success" || d.status === "failed"
        ? html`<button class="btn sm ghost icon-only danger" data-delete="${d.id}" title="Delete" aria-label="Delete dump">${icon("trash")}</button>`
        : ""}
    </td>
  </tr>`;

export const renderDumps = async ({ root, query, onDump, navigate }) => {
  let dumps = [];
  let jobs = [];
  let status = query.status || "";
  let jobFilter = query.job || "";
  let search = "";

  root.innerHTML = html`
    <div class="page-head">
      <div><h1>Dumps</h1><p>Every backup run, its result and the compressed file to download.</p></div>
      <button class="btn" id="refresh">${icon("refresh")} Refresh</button>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Filter by status" id="status-filter"></div>
        <select class="input" id="job-filter" style="width:auto;min-width:180px" aria-label="Filter by job"></select>
        <div class="grow input-icon">${icon("search")}<input class="input" id="search" placeholder="Search job or database…" /></div>
      </div>
      <div id="table">${skeleton(56, "margin:16px")}${skeleton(56, "margin:16px")}${skeleton(56, "margin:16px")}</div>
    </div>`.s;

  const paintFilters = () => {
    $("#status-filter").innerHTML = html`${FILTERS.map(
      ([v, l]) => html`<button type="button" data-status="${v}" aria-pressed="${status === v}">${l}</button>`
    )}`.s;
    $("#job-filter").innerHTML = html`<option value="">All jobs</option>${jobs.map(
      (j) => html`<option value="${j.id}" ${j.id === jobFilter ? "selected" : ""}>${j.name}</option>`
    )}`.s;
  };

  const visible = () => {
    const q = search.toLowerCase();
    return dumps.filter((d) => {
      if (status === "running" && !["running", "queued"].includes(d.status)) return false;
      if (status && status !== "running" && d.status !== status) return false;
      if (jobFilter && d.job !== jobFilter) return false;
      if (q && !`${d.jobName} ${d.database} ${d.host}`.toLowerCase().includes(q)) return false;
      return true;
    });
  };

  const paintTable = () => {
    const list = visible();
    $("#table").innerHTML = list.length
      ? html`<table class="table">
          <thead><tr><th>Job</th><th>Status</th><th>Started</th><th class="num">Duration</th><th class="num">Size</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${list.map(row)}</tbody>
        </table>`.s
      : emptyState({
          iconName: "archive",
          title: dumps.length ? "Nothing matches these filters" : "No dumps yet",
          text: dumps.length ? "Try a different status, job or search term." : "Run a backup job and its dump will appear here, live.",
          action: dumps.length ? "" : html`<a class="btn primary" href="#/jobs">${icon("calendar")} Go to backup jobs</a>`,
        }).s;
  };

  const load = async () => {
    const [d, j] = await Promise.all([api.get("/dumps?limit=300"), api.get("/jobs")]);
    dumps = d.dumps;
    jobs = j.jobs;
    paintFilters();
    paintTable();
    if (query.focus) {
      const tr = root.querySelector(`tr[data-id="${query.focus}"]`);
      if (tr) {
        tr.scrollIntoView({ block: "center", behavior: "smooth" });
        tr.classList.add("flash");
      }
    }
  };

  root.addEventListener("click", async (e) => {
    const s = e.target.closest("[data-status]");
    if (s) {
      status = s.dataset.status;
      paintFilters();
      paintTable();
      return;
    }
    if (e.target.closest("#refresh")) {
      await load();
      return;
    }
    const del = e.target.closest("[data-delete]");
    if (del) {
      const ok = await confirmDialog({
        title: "Delete this dump?",
        description: "The file will be permanently removed from storage.",
        confirmLabel: "Delete dump",
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/dumps/${del.dataset.delete}`);
        dumps = dumps.filter((d) => d.id !== del.dataset.delete);
        paintTable();
        toast({ type: "success", title: "Dump deleted" });
      } catch (err) {
        toast({ type: "error", title: "Delete failed", message: err.message });
      }
    }
  });

  root.addEventListener("change", (e) => {
    if (e.target.id === "job-filter") {
      jobFilter = e.target.value;
      navigate(jobFilter ? `/dumps?job=${jobFilter}` : "/dumps");
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      search = e.target.value;
      paintTable();
    }
  });

  // Live updates: upsert the changed row without re-animating the table.
  onDump((d, kind) => {
    if (kind === "deleted") dumps = dumps.filter((x) => x.id !== d.id);
    else {
      const i = dumps.findIndex((x) => x.id === d.id);
      if (i >= 0) dumps[i] = d;
      else dumps.unshift(d);
    }
    const tr = root.querySelector(`tr[data-id="${d.id}"]`);
    if (tr && kind !== "deleted" && visible().some((x) => x.id === d.id)) {
      const tmp = document.createElement("tbody");
      tmp.innerHTML = row(d, 0).s;
      tmp.firstElementChild.style.animation = "none";
      if (d.status === "success" || d.status === "failed") tmp.firstElementChild.classList.add("flash");
      tr.replaceWith(tmp.firstElementChild);
    } else {
      paintTable();
    }
  });

  await load();
};
