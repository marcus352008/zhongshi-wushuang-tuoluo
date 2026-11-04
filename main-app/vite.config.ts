import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: '0.0.0.0', port: 47321, strictPort: true },
  preview: { host: '0.0.0.0', port: 47322 },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
