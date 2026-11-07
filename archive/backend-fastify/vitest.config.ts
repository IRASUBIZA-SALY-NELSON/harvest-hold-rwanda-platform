import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://harvest:harvest@127.0.0.1:5440/harvest_test',
      SECRET: 'test-secret',
      SMS_DRIVER: 'none',
      CROP_PROFILES_DIR: '../crop-profiles',
      FIRMWARE_DIR: path.join(os.tmpdir(), 'harvest-hold-test-firmware'),
    },
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
