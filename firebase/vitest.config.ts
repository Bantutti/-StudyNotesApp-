import { defineConfig } from 'vitest/config';

// Rules tests share one emulator, so files run one at a time (no cross-file clears).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
