import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node apps/server/dist/index.js",
      url: "http://127.0.0.1:5174/health",
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "5174",
        WEB_ORIGIN: "http://127.0.0.1:5174",
        VEDRAS_DATA_DIR: ".codex-tmp/playwright-rooms",
      },
    },
  ],
});
