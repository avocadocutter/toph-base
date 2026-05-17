import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const apiUrl = process.env.VIBEBASE_API_URL ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/auth': apiUrl,
      '/rest': apiUrl,
      '/realtime': apiUrl,
      '/vibebase': apiUrl,
      '/admin': apiUrl,
      '/health': apiUrl,
    },
  },
});
