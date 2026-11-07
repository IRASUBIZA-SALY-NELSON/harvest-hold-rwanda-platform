import { Logger } from '@nestjs/common';

import { createApp } from './bootstrap.js';
import { config } from './config.js';

const app = await createApp();
await app.listen({ host: '0.0.0.0', port: config.port });
Logger.log(`Harvest Hold API on :${config.port} (SMS: ${config.sms.driver})`, 'Main');
