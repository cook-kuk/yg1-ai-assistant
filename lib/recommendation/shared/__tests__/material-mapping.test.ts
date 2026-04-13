import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  _resetMaterialMappingCacheForTest,
  _setMaterialMappingTestPaths,
  buildMaterialKnowledgeIndex,
  buildScopedMaterialPromptHints,
  findBrandSeriesHintsForMaterial,
  loadMaterialMappingCsv,
  lookupMaterialFamily,
  normalizeMaterialAlias,
  resolveMaterialFamilyName,
  resolveMaterialIsoTagForFamily,
} from "../material-mapping"

function csvCell(value: unknown): string {
  const text = String(value ?? "")
  if (/[,"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",")
}

describe("material-mapping CSV integration", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yg1-material-mapping-"))

    const materialPath = path.join(tempDir, "material_mapping_lv1_lv2_lv3.csv")
    const brandAffinityPath = path.join(tempDir, "public__brand_material_affinity.csv")
    const seriesProfilePath = path.join(tempDir, "catalog_app__series_profile_mv.csv")

    fs.writeFileSync(materialPath, [
      csvLine([
        "LV1_ISO",
        "LV2_Category",
        "LV3_Category",
        "Material_Description",
        "Composition_Heat_Treatment",
        "Material_No",
        "JIS",
        "DIN",
        "AISI_ASTM_SAE",
        "BS",
        "EN",
        "AFNOR",
        "SS",
        "UNI",
        "UNE_IHA",
        "UNS",
        "GOST",
        "GB",
      ]),
      csvLine(["P", "Carbon Steel", "Low Carbon", "Non-alloyed carbon steel", "annealed", "1.0037", "S10C", "C10", "1010", "", "C10", "", "", "", "", "G10100", "", ""]),
      csvLine(["M", "Stainless Steel", "Austenitic", "Austenitic stainless work material", "solution treated", "SUS304X", "SUS304X", "", "", "", "SUS304X", "", "", "", "", "", "", ""]),
      csvLine(["S", "Super Alloy", "Inconel", "Nickel-based heat resistant alloy", "age hardened", "NICKEL-ALLOY-77", "NICKEL-ALLOY-77", "", "", "", "NICKEL-ALLOY-77", "", "", "", "", "", "", ""]),
    ].join("\n"))

    fs.writeFileSync(brandAffinityPath, [
      csvLine(["brand", "material_key", "rating_score", "notes"]),
      csvLine(["YG1", "M", 0.85, "stainless"]),
      csvLine(["YG1", "S", 0.95, "heat resistant"]),
    ].join("\n"))

    fs.writeFileSync(seriesProfilePath, [
      csvLine(["series_name", "primary_brand_name", "edp_count", "material_tags", "material_work_piece_names", "work_piece_statuses"]),
      csvLine([
        "INOX-MASTER",
        "YG1",
        8,
        JSON.stringify(["M"]),
        JSON.stringify(["Stainless", "Stainless Steel"]),
        JSON.stringify([{ tag_name: "M", work_piece_name: "Stainless", material_rating: "GOOD", material_rating_score: 2 }]),
      ]),
      csvLine([
        "TitaNox-Power",
        "YG1",
        12,
        JSON.stringify(["S"]),
        JSON.stringify(["Inconel", "Nickel Alloy"]),
        JSON.stringify([{ tag_name: "S", work_piece_name: "Inconel", material_rating: "EXCELLENT", material_rating_score: 3 }]),
      ]),
    ].join("\n"))

    _setMaterialMappingTestPaths({
      materialPath,
      brandAffinityPath,
      seriesProfilePath,
    })
  })

  afterEach(() => {
    _resetMaterialMappingCacheForTest()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it("loads the CSV rows from the configured material mapping asset", () => {
    const rows = loadMaterialMappingCsv()

    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual(expect.objectContaining({
      LV1_ISO: "P",
      Material_No: "1.0037",
      JIS: "S10C",
      AISI_ASTM_SAE: "1010",
    }))
  })

  it("uses the bundled material snapshot when no external path override is set", () => {
    _setMaterialMappingTestPaths({
      materialPath: null,
      brandAffinityPath: null,
      seriesProfilePath: null,
    })

    const rows = loadMaterialMappingCsv()
    expect(rows.length).toBeGreaterThan(0)
    expect(normalizeMaterialAlias("SUS316L")).toEqual(expect.objectContaining({
      canonicalFamily: "Stainless",
      lv1Iso: "M",
    }))
  })

  it("normalizes aliases, resolves family fallbacks, and builds prompt hints", () => {
    const exact = normalizeMaterialAlias("SUS304X")
    expect(exact).toEqual(expect.objectContaining({
      canonicalFamily: "Stainless",
      lv1Iso: "M",
      matchedAlias: "SUS304X",
    }))

    const family = resolveMaterialFamilyName("SUS304X")
    expect(family).toBe("Stainless")

    const iso = resolveMaterialIsoTagForFamily("Stainless")
    expect(iso).toBe("M")

    const hints = findBrandSeriesHintsForMaterial("SUS304X")
    expect(hints.brandHints).toContain("YG1")
    expect(hints.seriesHints).toContain("INOX-MASTER")
    expect(hints.confidence).toBeGreaterThan(0)

    const promptHints = buildScopedMaterialPromptHints("SUS304X")
    expect(promptHints).toContain("detected family: Stainless")
    expect(promptHints).toContain("brand hints: YG1")
    expect(promptHints).toContain("series hints: INOX-MASTER")
  })

  it("resolves country/spec aliases across JIS, AISI, and material number columns", () => {
    expect(lookupMaterialFamily("S10C")).toEqual(expect.objectContaining({
      canonicalFamily: "Carbon Steel",
      lv1Iso: "P",
      sourceColumn: "JIS",
    }))

    expect(lookupMaterialFamily("AISI 1010")).toEqual(expect.objectContaining({
      canonicalFamily: "Carbon Steel",
      lv1Iso: "P",
      sourceColumn: "AISI_ASTM_SAE",
    }))

    expect(lookupMaterialFamily("1.0037")).toEqual(expect.objectContaining({
      canonicalFamily: "Carbon Steel",
      lv1Iso: "P",
      sourceColumn: "Material_No",
    }))
  })

  it("uses Material_Description signals when no exact alias exists", () => {
    const inferred = lookupMaterialFamily("need a tool for heat resistant nickel alloy")

    expect(inferred).toEqual(expect.objectContaining({
      canonicalFamily: "Inconel",
      lv1Iso: "S",
      sourceColumn: "Material_Description",
    }))

    const knowledge = buildMaterialKnowledgeIndex().find(entry => entry.canonicalFamily === "Inconel")
    expect(knowledge?.strengthSignals).toEqual(expect.arrayContaining(["super alloy", "age hardened"]))
  })

  it("uses CSV-backed family inference for alloy aliases", () => {
    const family = resolveMaterialFamilyName("NICKEL-ALLOY-77")
    expect(family).toBe("Inconel")
    expect(resolveMaterialIsoTagForFamily("Inconel")).toBe("S")
  })
})
