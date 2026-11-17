import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [react(), {
    name: 'development-csp',
    // React Fast Refresh uses an inline preamble in development only.
    transformIndexHtml(html) {
      return command === 'serve' ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html;
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
}));
