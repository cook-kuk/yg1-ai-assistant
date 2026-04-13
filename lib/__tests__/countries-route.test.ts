import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const queryMock = vi.fn()

vi.mock("pg", () => ({
  Pool: class MockPool {
    query = queryMock
  },
}))

describe("GET /api/countries", () => {
  beforeEach(() => {
    queryMock.mockReset()
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"
  })

  it("qualifies the unnested country alias in the SQL and returns country rows", async () => {
    queryMock.mockResolvedValue({
      rows: [{ country: "KOREA" }, { country: "EUROPE" }],
    })

    const { COUNTRIES_SQL, GET } = await import("../../app/api/countries/route")
    const response = await GET()
    const body = await response.json()

    expect(COUNTRIES_SQL).toContain("country_row.country")
    expect(queryMock).toHaveBeenCalledWith(COUNTRIES_SQL)
    expect(body).toEqual({ countries: ["KOREA", "EUROPE"] })
  })
})
