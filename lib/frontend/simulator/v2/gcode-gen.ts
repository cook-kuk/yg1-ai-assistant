export interface GCodeParams {
  n: number       // RPM
  Vf: number      // mm/min
  ap: number
  ae: number
  D: number
  toolNo: number
  dialect?: "fanuc" | "heidenhain" | "siemens"
  coolant?: "flood" | "dry" | "mql" | "mist" | "air" | "throughspindle"
}

const COOLANT_CODE: Record<string, string> = {
  flood: "M08",
  throughspindle: "M08 (THROUGH)",
  mist: "M07",
  mql: "M07 (MQL)",
  air: "M26",
  dry: "M09",
}

export function generateGCode(p: GCodeParams): string {
  const { n, Vf, ap, ae, D, toolNo, dialect = "fanuc", coolant = "flood" } = p
  const cc = COOLANT_CODE[coolant] ?? "M08"
  const nRounded = Math.round(n)
  const fRounded = Math.round(Vf)
  if (dialect === "heidenhain") {
    return [
      `; HEIDENHAIN iTNC 530 / TNC 640`,
      `; D=${D}mm  ap=${ap}  ae=${ae}`,
      `TOOL CALL ${toolNo} Z S${nRounded}`,
      `L Z+50 R0 FMAX M3`,
      `L X+0 Y+0 FMAX M${coolant === "dry" ? "9" : "8"}`,
      `L Z-${ap} F${fRounded}`,
      `; ... 가공 경로 ...`,
      `L Z+50 FMAX M9`,
      `M30`,
    ].join("\n")
  }
  if (dialect === "siemens") {
    return [
      `; SIEMENS 840D`,
      `; D=${D}mm  ap=${ap}  ae=${ae}`,
      `T${toolNo} D1`,
      `S${nRounded} M3`,
      `${cc === "M26" ? "M26" : cc}`,
      `G0 X0 Y0 Z50`,
      `G1 Z-${ap} F${fRounded}`,
      `; ... cutting moves ...`,
      `G0 Z50`,
      `M30`,
    ].join("\n")
  }
  // Fanuc default
  return [
    `( FANUC / HAAS )`,
    `( D=${D}mm  ap=${ap}mm  ae=${ae}mm  fz=${(Vf / n).toFixed(4)}mm/rev )`,
    `O0001`,
    `G21 G17 G40 G49 G80 G90`,
    `T${toolNo.toString().padStart(2, "0")} M06`,
    `G54 G00 X0. Y0. S${nRounded} M03`,
    `G43 Z50. H${toolNo.toString().padStart(2, "0")} ${cc}`,
    `G01 Z-${ap.toFixed(3)} F${fRounded}.`,
    `( ... 가공 경로 ... )`,
    `G00 Z100. M09`,
    `M05`,
    `M30`,
    `%`,
  ].join("\n")
}
