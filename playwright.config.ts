import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  use: {
    baseURL: process.env.TRACE_LEDGER_URL || "http://127.0.0.1:4173",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 1440, height: 1050 },
  },
  reporter: [["list"], ["json", { outputFile: "docs/browser-results.json" }]],
});
