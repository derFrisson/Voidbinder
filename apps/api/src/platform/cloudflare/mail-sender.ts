import { MAIL_FROM, type MailSender } from '../../auth/mail';

/** Cloudflare Email Service through the `send_email` binding (structured `send()` API). */
export function bindingMailSender(binding: SendEmail): MailSender {
  return {
    async send(message) {
      await binding.send({ from: MAIL_FROM, ...message });
    },
  };
}
