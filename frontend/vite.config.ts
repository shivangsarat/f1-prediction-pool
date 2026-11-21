import { defineConfig } from 'vite';

/** Proxy API calls during development without consuming the production frontend port. */
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3001' },
  },
  build: { outDir: 'dist' },
});
