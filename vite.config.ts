import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:4317' } },
});
