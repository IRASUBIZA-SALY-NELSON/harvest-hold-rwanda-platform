import { Injectable, Logger } from '@nestjs/common';

import { config } from '../../config.js';

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

const africasTalking: SmsSender = {
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

/** SMS: Africa's Talking in production, the log in development. */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SMS');
  private sender: SmsSender =
    config.sms.driver === 'africastalking'
      ? africasTalking
      : config.sms.driver === 'none'
        ? { send: async () => {} }
        : { send: async (to, text) => this.log.log(`[SMS to ${to}] ${text}`) };

  send(to: string, text: string) {
    return this.sender.send(to, text);
  }

  /** Tests swap the sender to capture messages. */
  use(sender: SmsSender) {
    this.sender = sender;
  }
}
