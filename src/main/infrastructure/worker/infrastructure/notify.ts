import type { INotifier } from '../application/ports.js';
import type { Config } from '../domain/types.js';

export type SendEmail = {
  send(message: EmailMessage): Promise<void>;
};

export type EmailMessage = {
  to: string;
  from: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
};

export class EmailNotifier implements INotifier {
  constructor(
    private readonly email: SendEmail,
    private readonly cfg: Config['notifications'],
  ) {}

  async send(subject: string, html: string, text: string): Promise<boolean> {
    if (!this.email || !this.cfg.to_email || !this.cfg.from_email) {
      return false;
    }

    try {
      await this.email.send({
        to: this.cfg.to_email,
        from: { email: this.cfg.from_email, name: 'Market Intel' },
        subject,
        html,
        text,
      });
      return true;
    } catch {
      return false;
    }
  }
}
