import os from 'node:os';
import path from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC (not esbuild) so NestJS gets the decorator metadata it needs for dependency injection.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://harvest:harvest@127.0.0.1:5440/harvest_test',
      SECRET: 'test-secret-that-is-long-enough-for-tests-0123456789',
      SMS_DRIVER: 'none',
      CROP_PROFILES_DIR: '../crop-profiles',
      FIRMWARE_DIR: path.join(os.tmpdir(), 'harvest-hold-test-firmware'),
      UPLOADS_DIR: path.join(os.tmpdir(), 'harvest-hold-test-uploads'),
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
