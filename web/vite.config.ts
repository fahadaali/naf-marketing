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
    // مولّد Excel وقارئه في src/services يستوردهما قالب خطة المحتوى — مولّدٌ واحد
    // للتقرير والقالب. والبناء يقرؤهما بلا إعداد، وخادم التطوير يمنع ما خارج
    // web/ ما لم يُسمح به: هذا المجلد وحده لا المستودع كلّه.
    fs: { allow: ['.', '../src/services'] },
    proxy: {
      // أثناء التطوير: مرّر نداءات /api إلى Worker (wrangler dev على 8787)
      '/api': 'http://localhost:8787',
    },
  },
});
