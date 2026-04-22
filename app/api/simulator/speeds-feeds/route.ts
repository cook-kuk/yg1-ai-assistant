// GET /api/simulator/speeds-feeds
// Harvey MAP 식 cascade lookup: toolId × materialSubgroup × operation × coating.
//
// 쿼리:
//   toolId              (필수)            예: "942332" / "EHD84100"
//   materialSubgroup    (권장)            예: "aluminum-wrought" (presets.MATERIAL_SUBGROUPS.key)
//   materialGroup       (fallback용)      예: "N" / "P" / "M" / "K" / "S" / "H"
//   operation           (옵션)            "finishing" | "roughing" | "slotting" | "max"
//   coating             (옵션)            "UN" | "AlTiN" | "AlCrN" | "DLC" | "TiB2" | "Diamond"
//   verbose             (옵션)            "true" 이면 matchPath + eduSummary 포함
//
// Cascade:
//   1) 정확 매칭 (toolId + subgroup + operation + coating)
//   2) coating 변종 매칭 (coating 제약 제거)
//   3) 재질 그룹 매칭 (materialGroup 만 매칭)
//   4) 동일 tool의 아무 entry (last resort)
//   5) null (matched=false)
//
// 데이터 소스: data/tool-speeds-feeds/**/*.json (benchmarks 폴더 포함, 재귀 스캔)

import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import type {
  SpeedsFeedsRow,
  ToolSpeedsFeedsEntry,
  SpeedsFeedsLookupResponse,
} from "@/lib/frontend/simulator/v2/speeds-feeds-types"

// ── 파일 캐시 (서버 런타임 동안 1회 로드) ──
let _toolCache: ToolSpeedsFeedsEntry[] | null = null
let _cacheError: string | null = null

const DATA_ROOT = path.join(process.cwd(), "data", "tool-speeds-feeds")

/** data/tool-speeds-feeds/ 하위 .json 재귀 수집 */
async function walkJson(dir: string): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true }) as unknown as typeof entries
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const name = String(e.name)
    const full = path.join(dir, name)
    if (e.isDirectory()) {
      out.push(...(await walkJson(full)))
    } else if (e.isFile() && name.endsWith(".json")) {
      out.push(full)
    }
  }
  return out
}

/**
 * 로드된 JSON을 ToolSpeedsFeedsEntry[] 로 정규화.
 * - 단일 객체(harvey-942332.json 스타일) → [obj]
 * - { tools: [...] } (yg1-seed.json 스타일) → obj.tools
 * - 배열 → 그대로
 */
function normalizeFile(parsed: unknown): ToolSpeedsFeedsEntry[] {
  if (!parsed) return []
  if (Array.isArray(parsed)) {
    return parsed.filter(isToolEntry)
  }
  if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.tools)) {
      return (obj.tools as unknown[]).filter(isToolEntry)
    }
    if (isToolEntry(obj)) return [obj]
  }
  return []
}

function isToolEntry(v: unknown): v is ToolSpeedsFeedsEntry {
  if (!v || typeof v !== "object") return false
  const r = v as Record<string, unknown>
  return (
    typeof r.toolId === "string" &&
    typeof r.seriesId === "string" &&
    Array.isArray(r.entries)
  )
}

async function loadAllTools(): Promise<ToolSpeedsFeedsEntry[]> {
  if (_toolCache) return _toolCache
  try {
    const files = await walkJson(DATA_ROOT)
    const all: ToolSpeedsFeedsEntry[] = []
    for (const f of files) {
      try {
        const raw = await fs.readFile(f, "utf8")
        const parsed = JSON.parse(raw)
        all.push(...normalizeFile(parsed))
      } catch (err) {
        // 개별 파일 실패는 warning으로 남기고 계속
        console.warn(`[speeds-feeds] skip ${f}:`, err instanceof Error ? err.message : err)
      }
    }
    _toolCache = all
    _cacheError = null
    return all
  } catch (err) {
    _cacheError = err instanceof Error ? err.message : String(err)
    _toolCache = []
    return []
  }
}

// ── Matching helpers ──
function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase()
}

function matchTool(tools: ToolSpeedsFeedsEntry[], toolId: string): ToolSpeedsFeedsEntry | null {
  const needle = normalize(toolId)
  if (!needle) return null
  // 1) 정확 toolId
  let hit = tools.find(t => normalize(t.toolId) === needle)
  if (hit) return hit
  // 2) seriesId 완전일치
  hit = tools.find(t => normalize(t.seriesId) === needle)
  if (hit) return hit
  // 3) toolId prefix 또는 series 포함
  hit = tools.find(t => normalize(t.toolId).startsWith(needle) || needle.startsWith(normalize(t.seriesId)))
  if (hit) return hit
  return null
}

interface CascadeInput {
  materialSubgroup?: string | null
  materialGroup?: string | null
  operation?: string | null
  coating?: string | null
}

/**
 * 4단계 cascade 매칭. 매칭된 row 와 reasoning 경로를 같이 반환.
 */
function cascadeRow(
  tool: ToolSpeedsFeedsEntry,
  req: CascadeInput,
): { row: SpeedsFeedsRow | null; path: string[] } {
  const path: string[] = []
  const wantSub = normalize(req.materialSubgroup)
  const wantGrp = normalize(req.materialGroup)
  const wantOp = normalize(req.operation)
  const wantCoat = normalize(req.coating)

  const toolCoat = normalize(tool.coating)
  path.push(`tool=${tool.toolId} (coating=${tool.coating})`)

  // 1) 정확 매칭 (subgroup + operation + coating)
  if (wantSub && wantOp) {
    const exact = tool.entries.find(r =>
      normalize(r.materialSubgroup) === wantSub &&
      normalize(r.operation) === wantOp &&
      (!wantCoat || wantCoat === toolCoat)
    )
    if (exact) {
      path.push(`✓ exact: subgroup=${wantSub} · operation=${wantOp} · coating=${wantCoat || "n/a"}`)
      return { row: exact, path }
    }
    path.push(`✗ exact miss (subgroup=${wantSub} · operation=${wantOp})`)
  }

  // 2) coating 변종 (coating 제약 제거) — subgroup+operation
  if (wantSub && wantOp) {
    const coatFree = tool.entries.find(r =>
      normalize(r.materialSubgroup) === wantSub &&
      normalize(r.operation) === wantOp,
    )
    if (coatFree) {
      path.push(`✓ coating-variant: subgroup=${wantSub} · operation=${wantOp} (coating 무시)`)
      return { row: coatFree, path }
    }
    path.push("✗ coating-variant miss")
  }

  // 3a) subgroup만 매칭 (operation 완화)
  if (wantSub) {
    const sgOnly = tool.entries.find(r => normalize(r.materialSubgroup) === wantSub)
    if (sgOnly) {
      path.push(`✓ subgroup-only: subgroup=${wantSub} (operation 완화)`)
      return { row: sgOnly, path }
    }
    path.push(`✗ subgroup-only miss (subgroup=${wantSub})`)
  }

  // 3b) materialGroup + operation 매칭
  if (wantGrp && wantOp) {
    const grp = tool.entries.find(r =>
      normalize(r.materialGroup) === wantGrp &&
      normalize(r.operation) === wantOp,
    )
    if (grp) {
      path.push(`✓ group+op: group=${wantGrp} · operation=${wantOp}`)
      return { row: grp, path }
    }
    path.push(`✗ group+op miss`)
  }

  // 3c) materialGroup만 매칭
  if (wantGrp) {
    const grp = tool.entries.find(r => normalize(r.materialGroup) === wantGrp)
    if (grp) {
      path.push(`✓ group-only: group=${wantGrp}`)
      return { row: grp, path }
    }
    path.push(`✗ group-only miss`)
  }

  // 4) operation 만 매칭
  if (wantOp) {
    const opOnly = tool.entries.find(r => normalize(r.operation) === wantOp)
    if (opOnly) {
      path.push(`✓ operation-only fallback: operation=${wantOp}`)
      return { row: opOnly, path }
    }
  }

  // 5) 첫번째 entry fallback
  if (tool.entries.length > 0) {
    path.push("✓ last-resort: tool의 첫 entry")
    return { row: tool.entries[0], path }
  }

  path.push("✗ tool에 entries 없음")
  return { row: null, path }
}

// ── GET handler ──
export async function GET(req: NextRequest): Promise<NextResponse<SpeedsFeedsLookupResponse | { error: string }>> {
  const { searchParams } = new URL(req.url)
  const toolId = searchParams.get("toolId")
  const materialSubgroup = searchParams.get("materialSubgroup")
  const materialGroup = searchParams.get("materialGroup")
  const operation = searchParams.get("operation")
  const coating = searchParams.get("coating")
  const verbose = searchParams.get("verbose") === "true"

  if (!toolId) {
    return NextResponse.json({ error: "toolId parameter required" }, { status: 400 })
  }

  try {
    const tools = await loadAllTools()
    if (tools.length === 0 && _cacheError) {
      return NextResponse.json({ error: `data load failed: ${_cacheError}` }, { status: 500 })
    }

    const tool = matchTool(tools, toolId)
    if (!tool) {
      const resp: SpeedsFeedsLookupResponse = {
        matched: false,
        row: null,
        source: "none",
        confidence: 0,
        ...(verbose && {
          matchPath: [`✗ toolId=${toolId} not found in data/tool-speeds-feeds`],
          meta: { toolId, materialSubgroup, materialGroup, operation, coating },
        }),
      }
      return NextResponse.json(resp)
    }

    const { row, path } = cascadeRow(tool, { materialSubgroup, materialGroup, operation, coating })

    const resp: SpeedsFeedsLookupResponse = {
      matched: !!row,
      row,
      source: row?.source ?? "none",
      confidence: row?.confidence ?? 0,
      ...(verbose && {
        matchPath: path,
        eduSummary: tool.eduSummary,
        meta: {
          toolId: tool.toolId,
          materialSubgroup,
          materialGroup,
          operation,
          coating,
        },
      }),
    }
    return NextResponse.json(resp)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
