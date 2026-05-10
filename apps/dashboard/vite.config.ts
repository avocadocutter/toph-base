import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const dashboardPort = parseInt(process.env.DASHBOARD_PORT ?? '3000', 10);
const apiUrl = process.env.GATEWAY_URL ?? `http://localhost:${process.env.GATEWAY_PORT ?? '8000'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: dashboardPort,
    proxy: {
      '/platform': apiUrl,
      '/project/': apiUrl,
      '/health': apiUrl,
    },
  },
});
