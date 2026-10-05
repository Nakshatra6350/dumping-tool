import type { Mail } from "./mailer";

/** Email content, in the recipient's language. English is the fallback. */
type Content = Omit<Mail, "to">;

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** The shared DBRB email frame: brand bar, heading, body paragraphs, one button. */
const layout = (options: {
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  footer: string;
}) => `<!doctype html>
<html><body style="margin:0;background:#f5f6fa;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:5px;background:linear-gradient(135deg,#6366f1,#a855f7);background-color:#6366f1"></td></tr>
<tr><td style="padding:28px 28px 4px">
<div style="font-size:15px;font-weight:800;letter-spacing:.14em;color:#6366f1">DBRB</div>
<h1 style="margin:14px 0 0;font-size:21px;line-height:1.3">${escapeHtml(options.heading)}</h1>
</td></tr>
<tr><td style="padding:10px 28px 4px;font-size:14.5px;line-height:1.6;color:#4b5468">
${options.paragraphs.map((p) => `<p style="margin:10px 0">${escapeHtml(p)}</p>`).join("")}
</td></tr>
<tr><td style="padding:14px 28px 28px">
<a href="${escapeHtml(options.button.url)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:14px">${escapeHtml(options.button.label)}</a>
</td></tr></table>
<p style="font-size:12px;color:#7c8497;margin-top:16px">${escapeHtml(options.footer)}</p>
</td></tr></table></body></html>`;

const WELCOME = {
  en: {
    subject: (workspace: string) => `Welcome to DBRB: ${workspace} is ready`,
    heading: (name: string) => `Welcome, ${name}`,
    paragraphs: (workspace: string) => [
      `Your workspace "${workspace}" is ready. It has its own private database, separate from every other workspace.`,
      "Next, choose where your backups should be stored: on our servers, or in your own S3 bucket.",
    ],
    button: "Open your workspace",
    footer: "DBRB: your database will be right back.",
  },
  hi: {
    subject: (workspace: string) => `DBRB में आपका स्वागत है: ${workspace} तैयार है`,
    heading: (name: string) => `स्वागत है, ${name}`,
    paragraphs: (workspace: string) => [
      `आपका वर्कस्पेस "${workspace}" तैयार है। इसका अपना निजी डेटाबेस है, जो बाकी सभी वर्कस्पेस से अलग है।`,
      "अब चुनें कि आपके बैकअप कहाँ रखे जाएँ: हमारे सर्वर पर, या आपके अपने S3 बकेट में।",
    ],
    button: "अपना वर्कस्पेस खोलें",
    footer: "DBRB: आपका डेटाबेस बस अभी वापस आया।",
  },
} as const;

export const welcomeEmail = (
  locale: string,
  data: { name: string; workspace: string; appUrl: string },
): Content => {
  const t = locale === "hi" ? WELCOME.hi : WELCOME.en;
  const paragraphs = t.paragraphs(data.workspace);
  const url = `${data.appUrl}/settings/storage`;
  return {
    subject: t.subject(data.workspace),
    text: [t.heading(data.name), "", ...paragraphs, "", `${t.button}: ${url}`, "", t.footer].join("\n"),
    html: layout({
      heading: t.heading(data.name),
      paragraphs,
      button: { label: t.button, url },
      footer: t.footer,
    }),
  };
};
