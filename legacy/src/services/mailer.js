const nodemailer = require("nodemailer");
const config = require("../config");

const { email } = config;

let smtpTransport;
const smtp = () => {
  smtpTransport ??= nodemailer.createTransport({
    host: email.smtp.host,
    port: email.smtp.port,
    secure: email.smtp.secure,
    auth: email.smtp.user ? { user: email.smtp.user, pass: email.smtp.pass } : undefined,
  });
  return smtpTransport;
};

const postJson = async (url, headers, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${new URL(url).host} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
};

// Brevo and Resend are HTTPS APIs, which matters on hosts (like Render's free
// tier) that block outbound SMTP ports.
const providers = {
  console: async (msg) => {
    console.log(`[mail:console] to=${msg.to.join(", ")} subject="${msg.subject}"\n${msg.text}`);
  },
  smtp: async (msg) => {
    await smtp().sendMail({
      from: { name: email.fromName, address: email.from || email.smtp.user },
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  },
  brevo: (msg) =>
    postJson(
      "https://api.brevo.com/v3/smtp/email",
      { "api-key": email.brevoApiKey },
      {
        sender: { email: email.from, name: email.fromName },
        to: msg.to.map((addr) => ({ email: addr })),
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
      }
    ),
  resend: (msg) =>
    postJson(
      "https://api.resend.com/emails",
      { authorization: `Bearer ${email.resendApiKey}` },
      {
        from: `${email.fromName} <${email.from}>`,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }
    ),
};

const send = async (msg) => {
  const provider = providers[email.provider];
  if (!provider) throw new Error(`Unknown EMAIL_PROVIDER "${email.provider}"`);
  if (!msg.to?.length) return;
  await provider(msg);
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

const formatDuration = (ms) => {
  if (!ms && ms !== 0) return "-";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const dumpNotification = (dump) => {
  const ok = dump.status === "success";
  const link = `${config.appUrl}/#/dumps?focus=${dump._id}`;
  const subject = ok
    ? `Backup ready: ${dump.jobName} (${dump.database})`
    : `Backup failed: ${dump.jobName} (${dump.database})`;
  const rows = [
    ["Job", dump.jobName],
    ["Engine", dump.dbType === "postgres" ? "PostgreSQL" : "MySQL"],
    ["Database", `${dump.database} @ ${dump.host}`],
    ["Finished", new Date(dump.finishedAt).toUTCString()],
    ["Duration", formatDuration(dump.durationMs)],
    ...(ok ? [["Size (gzip)", formatBytes(dump.sizeBytes)]] : [["Error", dump.error]]),
  ];
  const accent = ok ? "#0ca30c" : "#d03b3b";

  const text = [
    ok ? "Your database dump completed successfully." : "Your database dump failed.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    ok ? `Sign in to download it: ${link}` : `Details: ${link}`,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:4px;background:${accent}"></td></tr>
<tr><td style="padding:28px 28px 8px">
<div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Dumping Tool</div>
<h1 style="margin:8px 0 4px;font-size:20px">${ok ? "&#10004; Backup ready" : "&#10006; Backup failed"}</h1>
<p style="margin:0;color:#4b5563;font-size:14px">${ok ? "Your database dump completed and is ready to download." : "The scheduled dump could not be completed."}</p>
</td></tr>
<tr><td style="padding:16px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 0;color:#6b7280;width:110px;vertical-align:top">${k}</td><td style="padding:6px 0;word-break:break-word">${escapeHtml(v)}</td></tr>`
  )
  .join("")}
</table></td></tr>
<tr><td style="padding:8px 28px 28px">
<a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:14px">${ok ? "Sign in &amp; download" : "View details"}</a>
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">You are receiving this because this address is on the job's notification list.</p>
</td></tr></table></body></html>`;

  return { subject, text, html };
};

const status = () => {
  const p = email.provider;
  const missing = {
    smtp: !email.smtp.host && "SMTP_HOST",
    brevo: (!email.brevoApiKey && "BREVO_API_KEY") || (!email.from && "EMAIL_FROM"),
    resend: (!email.resendApiKey && "RESEND_API_KEY") || (!email.from && "EMAIL_FROM"),
  }[p];
  return { provider: p, ready: p === "console" ? false : !missing, missing: missing || null };
};

module.exports = { send, dumpNotification, status, formatBytes };
