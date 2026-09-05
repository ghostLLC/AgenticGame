import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Many integration files launch two real strategy processes (and some
    // PowerShell or packaged executables). Bound aggregate CPU/process pressure.
    maxWorkers: process.env.CI ? 2 : 4,
  },
});
