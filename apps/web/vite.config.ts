import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const buildId = process.env.VEDRAS_BUILD_ID?.trim() || `v${process.env.npm_package_version ?? "0.1.0"}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __VEDRAS_BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
