import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";

export interface Mail {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email. "console" only logs the message (the default, so nothing is
 * sent by accident); "smtp" delivers through any SMTP server. Locally that is
 * Mailpit (http://localhost:8025); in production it becomes Amazon SES.
 */
export class Mailer {
  private transport: Transporter | null = null;

  constructor(
    private readonly config: AppConfig["mail"],
    private readonly log: Logger,
  ) {}

  async send(mail: Mail): Promise<void> {
    const to = Array.isArray(mail.to) ? mail.to : [mail.to];
    if (to.length === 0) return;

    if (this.config.driver === "console") {
      this.log.info({ to, subject: mail.subject }, "mail (console driver, not sent)");
      return;
    }

    const { host, port, secure, user, pass } = this.config.smtp;
    this.transport ??= nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
    await this.transport.sendMail({
      from: this.config.from,
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
  }
}
