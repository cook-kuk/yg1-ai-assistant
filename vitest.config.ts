import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    include: ["lib/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "lib/__mocks__/server-only.ts"),
    },
  },
})
