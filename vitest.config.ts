import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    // Starting a Postgres container can take a while the first time the image is pulled.
    hookTimeout: 180_000,
  },
});
