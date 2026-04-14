import { defineConfig, devices } from "@playwright/test"
import { readFileSync } from "node:fs"

const resolveWebServerCommand = (): string | undefined => {
  try {
    const scripts = JSON.parse(readFileSync("package.json", "utf-8")).scripts ?? {}
    if (scripts.dev) return "npm run dev"
    if (scripts.start) return "npm run start"
  } catch {
    // noop
  }
  return undefined
}

const resolvedWebServerCommand = resolveWebServerCommand()

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.BASE_URL || !resolvedWebServerCommand
    ? undefined
    : {
        command: resolvedWebServerCommand,
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
