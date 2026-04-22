import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("simulator build guards", () => {
  it("sim error boundary does not statically import sentry", () => {
    const file = readFileSync(
      path.join(process.cwd(), "lib/frontend/simulator/v2/sim-error-boundary.tsx"),
      "utf8",
    )
    expect(file).not.toMatch(/import\s+\*\s+as\s+Sentry\s+from\s+["']@sentry\/nextjs["']/)
  })

  it("sim logger stays dependency-light without pino import", () => {
    const file = readFileSync(
      path.join(process.cwd(), "lib/logger/sim-logger.ts"),
      "utf8",
    )
    expect(file).not.toContain('from "pino"')
  })
})
