import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // أثناء التطوير: مرّر نداءات /api إلى Worker (wrangler dev على 8787)
      '/api': 'http://localhost:8787',
    },
  },
});
