import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Same routing as Caddy's `@api path /api /api/*` (D11): /api and /api/..., not /apifoo.
    proxy: { '^/api(?:[/?]|$)': { target: 'http://localhost:3001', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
