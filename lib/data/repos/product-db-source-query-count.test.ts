import { beforeEach, describe, expect, it, vi } from "vitest"

const queryMock = vi.fn()
const poolConstructorMock = vi.fn(function MockPool() {
  return { query: queryMock }
})

vi.mock("server-only", () => ({}))
vi.mock("pg", () => ({
  Pool: poolConstructorMock,
}))
vi.mock("@/lib/slack-notifier", () => ({
  notifyDbQuery: vi.fn(() => Promise.resolve()),
}))
vi.mock("@/lib/runtime-logger", () => ({
  appendRuntimeLog: vi.fn(() => Promise.resolve()),
  logRuntimeError: vi.fn(() => Promise.resolve()),
}))

function createRawProductRow(overrides: Record<string, unknown> = {}) {
  return {
    edp_idx: "1",
    edp_no: "AB-123",
    edp_brand_name: "YG-1",
    edp_series_name: "Series-A",
    edp_series_idx: null,
    edp_root_category: "End Mill",
    edp_unit: "MM",
    option_z: null,
    option_numberofflute: "4",
    option_drill_diameter: null,
    option_d1: null,
    option_dc: null,
    option_d: "10",
    option_shank_diameter: null,
    option_dcon: null,
    option_flute_length: null,
    option_loc: null,
    option_overall_length: null,
    option_oal: null,
    option_r: null,
    option_re: null,
    option_taperangle: null,
    option_coolanthole: null,
    series_row_idx: null,
    series_brand_name: "YG-1",
    series_description: "Test Product",
    series_feature: "Feature",
    series_tool_type: "Solid",
    series_product_type: null,
    series_application_shape: "Facing",
    series_cutting_edge_shape: "Square",
    country_codes: ["KR"],
    material_tags: ["P"],
    milling_outside_dia: "10",
    milling_number_of_flute: "4",
    milling_coating: "TiAlN",
    milling_tool_material: "Carbide",
    milling_shank_dia: "10",
    milling_length_of_cut: "20",
    milling_overall_length: "70",
    milling_helix_angle: null,
    milling_ball_radius: null,
    milling_taper_angle: null,
    milling_coolant_hole: null,
    milling_cutting_edge_shape: "Square",
    milling_cutter_shape: null,
    holemaking_outside_dia: null,
    holemaking_number_of_flute: null,
    holemaking_coating: null,
    holemaking_tool_material: null,
    holemaking_shank_dia: null,
    holemaking_flute_length: null,
    holemaking_overall_length: null,
    holemaking_helix_angle: null,
    holemaking_coolant_hole: null,
    threading_outside_dia: null,
    threading_number_of_flute: null,
    threading_coating: null,
    threading_tool_material: null,
    threading_shank_dia: null,
    threading_thread_length: null,
    threading_overall_length: null,
    threading_coolant_hole: null,
    threading_flute_type: null,
    threading_thread_shape: null,
    search_diameter_mm: 10,
    search_coating: "TiAlN",
    search_subtype: "Square",
    ...overrides,
  }
}

describe("product db query count behavior", () => {
  beforeEach(() => {
    vi.resetModules()
    queryMock.mockReset()
    poolConstructorMock.mockClear()
    delete process.env.PRODUCT_REPO_SOURCE
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/yg1"
    delete globalThis.__yg1ProductDbPool
    delete globalThis.__yg1ProductDbConfigLogged
  })

  it("uses a single SQL query for non-paginated product searches", async () => {
    queryMock.mockResolvedValue({
      rows: [createRawProductRow()],
      rowCount: 1,
    })

    const { queryProductsFromDatabase } = await import("./product-db-source")
    const products = await queryProductsFromDatabase({ normalizedCode: "AB-123", limit: 1 })

    expect(products).toHaveLength(1)
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(String(queryMock.mock.calls[0]?.[0])).not.toContain("COUNT(*)")
  })

  it("keeps count and data queries for paginated searches", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ total_count: 3 }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [createRawProductRow()],
        rowCount: 1,
      })

    const { queryProductsPageFromDatabase } = await import("./product-db-source")
    const result = await queryProductsPageFromDatabase({ normalizedCode: "AB-123", limit: 1, offset: 0 })

    expect(result.totalCount).toBe(3)
    expect(result.products).toHaveLength(1)
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(String(queryMock.mock.calls[0]?.[0])).toContain("COUNT(*)")
    expect(String(queryMock.mock.calls[1]?.[0])).not.toContain("COUNT(*)")
  })
})
