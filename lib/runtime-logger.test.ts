import path from "node:path"
import { describe, expect, it } from "vitest"

import { resolveRuntimeLogPath } from "./runtime-logger"

describe("resolveRuntimeLogPath", () => {
  it("defaults to logs/runtime.log when unset", () => {
    expect(resolveRuntimeLogPath("")).toBe(path.join(process.cwd(), "logs", "runtime.log"))
  })

  it("keeps absolute paths unchanged", () => {
    expect(resolveRuntimeLogPath("/tmp/custom-runtime.log")).toBe("/tmp/custom-runtime.log")
  })

  it("normalizes relative paths under logs directory", () => {
    expect(resolveRuntimeLogPath("nested/runtime-custom.log")).toBe(
      path.join(process.cwd(), "logs", "runtime-custom.log"),
    )
  })
})
