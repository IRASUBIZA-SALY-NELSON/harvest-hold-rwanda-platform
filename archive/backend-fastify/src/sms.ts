import { config } from './config.js';

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** Development: prints the SMS to the server log. */
const consoleSender: SmsSender = {
  async send(to, text) {
    console.log(`[SMS to ${to}] ${text}`);
  },
};

/** Africa's Talking bulk SMS API. */
const africasTalkingSender: SmsSender = {
  async send(to, text) {
    const { atUsername, atApiKey, atSenderId, atSandbox } = config.sms;
    const host = atSandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const body = new URLSearchParams({ username: atUsername, to, message: text });
    if (atSenderId) body.set('from', atSenderId);
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey: atApiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS failed: ${res.status} ${await res.text()}`);
  },
};

let sender: SmsSender =
  config.sms.driver === 'africastalking' ? africasTalkingSender
  : config.sms.driver === 'none' ? { send: async () => {} }
  : consoleSender;

export const sms = {
  send: (to: string, text: string) => sender.send(to, text),
  /** Tests swap the sender to capture messages. */
  use(s: SmsSender) {
    sender = s;
  },
};
