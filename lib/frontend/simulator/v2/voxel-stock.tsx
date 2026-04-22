// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Voxel Stock Carving Animation (three.js / @react-three/fiber)
//
// Uint8Array 점유 그리드 기반 voxel 가공 애니메이션.
//   - 공구 팁(sphere) 교차 voxel을 매 프레임 제거
//   - 노출면(exposed-face) 추출로 BufferGeometry 재생성 (marching cubes 아님)
//   - 30Hz 이하로 리빌드 스로틀, ≥32 voxel 플립 또는 ≥4 frame 경과 시 재구성
//   - PBR 머티리얼 per-material
//
// 독립 모듈 — cutting-simulator-v2.tsx 는 건드리지 않는다.
"use client"

import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
// `three-mesh-bvh` is pulled in transitively by @react-three/drei. We import it
// for its three.js module augmentation (adds `computeBoundsTree` /
// `disposeBoundsTree` / `acceleratedRaycast`) and fall back gracefully at
// runtime if the package isn't actually resolvable.
import * as MeshBVH from "three-mesh-bvh"

// ─────────────────────────────────────────────
// SSOT constants
// ─────────────────────────────────────────────
const DEFAULT_RESOLUTION = 48
const REBUILD_VOXEL_THRESHOLD = 32
const REBUILD_FRAME_THRESHOLD = 4
const REBUILD_MAX_HZ = 30
const REBUILD_MIN_DT = 1 / REBUILD_MAX_HZ

// Thermal model constants
// COOL_RATE = 0.8 => full heat (1.0) decays to 0 in ~1.25 seconds.
const COOL_RATE = 0.8
// Contact heat propagation radius multiplier (applied on top of toolRadius).
const HEAT_RADIUS_OFFSET_FACTOR = 1.35

// Heat gradient stops used for vertex coloring. Matches the task spec:
//   0.0 -> base material color (resolved at build-time per material)
//   0.3 -> warm         (#e8a05b)
//   0.7 -> bright orange(#ff6a1f)
//   1.0 -> near white-hot(#ffd24a)
const HEAT_STOP_T = [0.0, 0.3, 0.7, 1.0] as const
const HEAT_STOP_RGB: [number, number, number][] = [
  [0, 0, 0], // placeholder; index 0 is overwritten with base color per-build
  [0xe8 / 255, 0xa0 / 255, 0x5b / 255],
  [0xff / 255, 0x6a / 255, 0x1f / 255],
  [0xff / 255, 0xd2 / 255, 0x4a / 255],
]

// ── Theoretical surface roughness (Ra) gradient ──────────────────────────────
// Ra is computed per carve event as (fz² / (32·r_nose)) in mm, then converted
// to micrometers (×1000). The value is stamped onto the 6 axis-aligned
// neighbors of each removed voxel (i.e. the freshly-exposed cut surface).
//
// Color ramp (µm) — maps machinist intuition to a traffic-light palette:
//   Ra < 0.5 µm        → #22c55e (green)  "mirror finish"
//   Ra 0.5 ~ 1.5 µm    → #eab308 (yellow)
//   Ra 1.5 ~ 3.0 µm    → #f97316 (orange)
//   Ra > 3.0 µm        → #ef4444 (red)    "rough"
// Linear lerp between stops; out-of-range values clamp to the endpoint color.
const RA_STOP_UM = [0.5, 1.5, 3.0] as const
const RA_STOP_RGB: [number, number, number][] = [
  [0x22 / 255, 0xc5 / 255, 0x5e / 255], // green  (≤0.5µm)
  [0xea / 255, 0xb3 / 255, 0x08 / 255], // yellow (0.5~1.5µm)
  [0xf9 / 255, 0x73 / 255, 0x16 / 255], // orange (1.5~3.0µm)
  [0xef / 255, 0x44 / 255, 0x44 / 255], // red    (≥3.0µm)
]

type MaterialKey = "steel" | "aluminum" | "copper" | "titanium"

interface MaterialStyle {
  color: string
  roughness: number
  metalness: number
}

const MATERIAL_STYLES: Record<MaterialKey, MaterialStyle> = {
  steel: { color: "#94a3b8", roughness: 0.55, metalness: 0.55 },
  aluminum: { color: "#cbd5e1", roughness: 0.35, metalness: 0.85 },
  copper: { color: "#e7875a", roughness: 0.3, metalness: 0.9 },
  titanium: { color: "#9ca3af", roughness: 0.45, metalness: 0.75 },
}

export interface VoxelStockProps {
  dimensions: [number, number, number]
  resolution?: number
  toolPosition: [number, number, number]
  toolRadius: number
  material?: MaterialKey
  onVolumeRemoved?: (mm3: number) => void
  /**
   * Optional world-space clipping planes applied to the voxel stock material.
   * When provided (and non-empty), the stock mesh uses `DoubleSide` so the
   * interior cross-section is visible at the clip. Non-breaking: omit to keep
   * prior (unclipped) behavior.
   */
  clippingPlanes?: THREE.Plane[]
  /**
   * Per-voxel thermal visualization intensity.
   *
   *   0  => disabled (default). Vertex-color heat gradient and emissive glow
   *         are both suppressed; behavior is identical to the pre-thermal
   *         version of this component.
   *   1  => full strength. Heat-gradient colors mix in proportional to
   *         per-voxel temperature, and the material's emissive intensity is
   *         scaled by the maximum stock temperature so the part glows in
   *         dark scenes.
   *
   * Values in between linearly lerp between "base color" and the hot gradient
   * and likewise scale emissive intensity.
   */
  thermalIntensity?: number
  /**
   * Optional seed geometry to voxelize as the initial stock.
   *
   * When provided:
   *   - The voxel volume bounds are DERIVED from this geometry's bounding box.
   *   - `dimensions` becomes a fallback used only for the empty-grid shell if
   *     voxelization is skipped (see memory guard below), and to size the
   *     local-space extents when the geometry bbox is degenerate.
   *   - Each voxel center is inside-tested via axis-aligned ray casting against
   *     a non-indexed clone of the geometry (odd intersection count = inside).
   *   - If `three-mesh-bvh` is available at runtime it is used to accelerate the
   *     raycast; otherwise a plain `THREE.Raycaster` is used and the effective
   *     grid is capped at 48^3 to keep initialization bounded.
   *   - As a hard memory guard, when the implied grid exceeds 64^3 voxels the
   *     voxelization is skipped, a console.warn is emitted, and the component
   *     falls back to the dense all-solid box behavior.
   *
   * When null/undefined, the component behaves exactly as before: a dense
   * all-solid box derived from `dimensions`.
   */
  initialGeometry?: THREE.BufferGeometry | null
  /**
   * Feed per tooth (mm). Used together with `cornerRadius` to compute the
   * theoretical peak-to-valley surface roughness each time a voxel is carved:
   *
   *   Ra [mm] = fz² / (32 · r_nose)
   *   Ra [µm] = Ra [mm] × 1000
   *
   * The resulting value (µm) is written into a parallel `raValue` grid on
   * the 6-connected neighbors of the carved voxel (i.e. the freshly-exposed
   * cut-surface). Defaults to 0.05 mm/tooth, a typical finishing feed.
   * Non-breaking: old callers omit this and the Ra grid is populated but
   * invisible (see `showRaOverlay`).
   */
  fz?: number
  /**
   * Nose / corner radius of the tool (mm). See `fz` for the Ra formula.
   * Defaults to 0.4 mm. Must be > 0 to produce a finite Ra — values ≤ 0 are
   * treated as 0.4 mm.
   */
  cornerRadius?: number
  /**
   * When true, the stock is vertex-colored by the per-voxel Ra map instead
   * of the base material / thermal gradient. Overrides `thermalIntensity`
   * for vertex colors (the emissive glow from thermal still applies so the
   * part doesn't go dark when heated while Ra is on). Defaults to false.
   */
  showRaOverlay?: boolean
  /**
   * Fires every time the exposed-face mesh geometry is rebuilt — i.e. on the
   * initial grid-build, after every throttled carve-driven rebuild inside
   * useFrame, and whenever the Ra overlay toggle forces a rebuild. The caller
   * receives the freshly-built `THREE.BufferGeometry` (same instance the mesh
   * is rendering) so it can stash it for 3D export or inspection. Non-owning —
   * the caller MUST NOT dispose the geometry since VoxelStock will dispose it
   * on the next rebuild or on unmount.
   */
  onGeometryUpdate?: (geom: THREE.BufferGeometry) => void
}

// Hard upper bound on any geometry-derived voxelization (nx*ny*nz).
const MAX_VOXELIZE_CELLS = 64 * 64 * 64
// Reduced cap when no BVH accelerator is available.
const MAX_VOXELIZE_CELLS_NO_BVH = 48 * 48 * 48

// Detect `three-mesh-bvh` at runtime. Even though we import it statically above
// (it's pulled in transitively by @react-three/drei), we still feature-detect
// in case the install has been pruned or the module didn't fully initialize —
// in that case we fall back to the raw raycaster with the 48^3 cap.
let meshBvhInstalled: boolean | undefined
let meshBvhPatched = false
function tryUseMeshBvh(): boolean {
  if (meshBvhInstalled === undefined) {
    meshBvhInstalled =
      typeof MeshBVH.computeBoundsTree === "function" &&
      typeof MeshBVH.disposeBoundsTree === "function" &&
      typeof MeshBVH.acceleratedRaycast === "function"
  }
  if (meshBvhInstalled && !meshBvhPatched) {
    // Patch three prototypes once. Idempotent; drei / other consumers may have
    // already patched but reassignment is harmless.
    ;(
      THREE.BufferGeometry.prototype as THREE.BufferGeometry
    ).computeBoundsTree = MeshBVH.computeBoundsTree
    ;(
      THREE.BufferGeometry.prototype as THREE.BufferGeometry
    ).disposeBoundsTree = MeshBVH.disposeBoundsTree
    ;(
      THREE.Raycaster.prototype as unknown as { raycast: unknown }
    ).raycast = MeshBVH.acceleratedRaycast
    meshBvhPatched = true
  }
  return meshBvhInstalled
}

// Quad face templates: 6 neighbor directions with 4 corner offsets (unit cube)
// Each entry: [dx, dy, dz], [normal components], [4 corner offsets for a unit cube face]
interface FaceDef {
  dir: [number, number, number]
  corners: [number, number, number][]
  normal: [number, number, number]
}

// Corner ordering chosen so (c0, c1, c2) and (c0, c2, c3) yield outward-facing triangles.
const FACES: FaceDef[] = [
  // +X
  {
    dir: [1, 0, 0],
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  // -X
  {
    dir: [-1, 0, 0],
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  // +Y
  {
    dir: [0, 1, 0],
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  // -Y
  {
    dir: [0, -1, 0],
    normal: [0, -1, 0],
    corners: [
      [0, 0, 1],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  },
  // +Z
  {
    dir: [0, 0, 1],
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  // -Z
  {
    dir: [0, 0, -1],
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
]

function idxOf(x: number, y: number, z: number, ny: number, nz: number): number {
  return x * ny * nz + y * nz + z
}

interface VoxelGrid {
  nx: number
  ny: number
  nz: number
  vx: number // voxel size along x (mm)
  vy: number
  vz: number
  data: Uint8Array
  // Per-voxel surface temperature in [0, 1], parallel to `data`. 1.0 = tool
  // contact temperature (white-hot), 0.0 = ambient. Decays each frame.
  temperature: Float32Array
  // Per-voxel surface roughness Ra (micrometers, µm), parallel to `data`.
  // 0 = untouched / virgin stock. Stamped onto the 6-connected neighbors of
  // each carved voxel with the theoretical Ra computed from fz² / (32·r_nose).
  raValue: Float32Array
  solidCount: number
}

function makeGrid(
  dimensions: [number, number, number],
  resolution: number,
): VoxelGrid {
  const [L, W, H] = dimensions
  const longest = Math.max(L, W, H)
  const voxelSize = longest / Math.max(2, Math.floor(resolution))
  const nx = Math.max(1, Math.round(L / voxelSize))
  const ny = Math.max(1, Math.round(W / voxelSize))
  const nz = Math.max(1, Math.round(H / voxelSize))
  const vx = L / nx
  const vy = W / ny
  const vz = H / nz
  const data = new Uint8Array(nx * ny * nz)
  data.fill(1)
  const temperature = new Float32Array(nx * ny * nz)
  const raValue = new Float32Array(nx * ny * nz)
  return {
    nx,
    ny,
    nz,
    vx,
    vy,
    vz,
    data,
    temperature,
    raValue,
    solidCount: nx * ny * nz,
  }
}

// Voxelize a BufferGeometry by testing each voxel center with an axis-aligned
// ray cast against the mesh; an odd hit count means "inside" (even-odd rule).
//
// Returns both the grid and the derived dimensions (bbox extents in mm) so the
// caller can use them as the stock's visual extents. If voxelization has to be
// skipped (geometry empty / degenerate / exceeds memory cap), returns null and
// the caller is expected to fall back to the dense-box path.
function voxelizeGeometry(
  geometry: THREE.BufferGeometry,
  resolution: number,
): { grid: VoxelGrid; dimensions: [number, number, number] } | null {
  // Ensure a bounding box exists.
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox) return null

  const sizeVec = new THREE.Vector3()
  bbox.getSize(sizeVec)
  const L = sizeVec.x
  const W = sizeVec.y
  const H = sizeVec.z
  if (!(L > 0) || !(W > 0) || !(H > 0)) return null

  const longest = Math.max(L, W, H)
  const voxelSize = longest / Math.max(2, Math.floor(resolution))
  let nx = Math.max(1, Math.round(L / voxelSize))
  let ny = Math.max(1, Math.round(W / voxelSize))
  let nz = Math.max(1, Math.round(H / voxelSize))

  // Memory guard: hard cap at 64^3. If we exceed it, fall back.
  if (nx * ny * nz > MAX_VOXELIZE_CELLS) {
    console.warn(
      `[VoxelStock] geometry voxelization skipped: ${nx}x${ny}x${nz} = ${
        nx * ny * nz
      } cells exceeds ${MAX_VOXELIZE_CELLS} cap; using dense box fallback.`,
    )
    return null
  }

  // Accelerator probe. When no BVH is available, clamp at 48^3 by rescaling
  // voxel size while preserving the aspect ratio of the bbox.
  const bvhAvailable = tryUseMeshBvh()
  if (!bvhAvailable && nx * ny * nz > MAX_VOXELIZE_CELLS_NO_BVH) {
    const scale = Math.cbrt(MAX_VOXELIZE_CELLS_NO_BVH / (nx * ny * nz))
    nx = Math.max(1, Math.floor(nx * scale))
    ny = Math.max(1, Math.floor(ny * scale))
    nz = Math.max(1, Math.floor(nz * scale))
  }

  const vx = L / nx
  const vy = W / ny
  const vz = H / nz

  // Work in geometry-local space for the raycast, then remap the occupancy grid
  // into the stock's centered-at-origin convention (see carveSphere comment).
  const minX = bbox.min.x
  const minY = bbox.min.y
  const minZ = bbox.min.z

  // Build a raycast-friendly mesh. We clone so we can toBoundsTree / attach BVH
  // without mutating the caller's geometry.
  const workGeom = geometry.clone()
  // Ensure a non-indexed form for the raw-raycaster path; BVH handles both.
  const prepared =
    !bvhAvailable && workGeom.index ? workGeom.toNonIndexed() : workGeom
  const mesh = new THREE.Mesh(prepared, new THREE.MeshBasicMaterial())

  const raycaster = new THREE.Raycaster()
  // Arbitrary +X axis ray; inside test is direction-agnostic.
  const rayDir = new THREE.Vector3(1, 0, 0)

  if (bvhAvailable) {
    prepared.computeBoundsTree()
    // Count every hit (even-odd inside test), not just the first.
    raycaster.firstHitOnly = false
  }

  const data = new Uint8Array(nx * ny * nz)
  let solidCount = 0
  const origin = new THREE.Vector3()
  // Push ray origin just outside the bbox on -X so we also catch surfaces at
  // the +X boundary correctly for centers that land on faces.
  const rayStartX = minX - Math.max(vx, 1e-4)

  for (let i = 0; i < nx; i++) {
    const cxLocal = minX + (i + 0.5) * vx
    for (let j = 0; j < ny; j++) {
      const cyLocal = minY + (j + 0.5) * vy
      for (let k = 0; k < nz; k++) {
        const czLocal = minZ + (k + 0.5) * vz
        origin.set(rayStartX, cyLocal, czLocal)
        raycaster.set(origin, rayDir)
        // Cap the ray at just past the voxel center so we only count crossings
        // to the LEFT of the center (classic even-odd inside test).
        raycaster.far = cxLocal - rayStartX
        const hits = raycaster.intersectObject(mesh, false)
        if ((hits.length & 1) === 1) {
          data[i * ny * nz + j * nz + k] = 1
          solidCount++
        }
      }
    }
  }

  // Dispose BVH / clone resources.
  if (bvhAvailable) {
    prepared.disposeBoundsTree()
  }
  if (prepared !== workGeom) prepared.dispose()
  workGeom.dispose()
  ;(mesh.material as THREE.Material).dispose()

  const temperature = new Float32Array(nx * ny * nz)
  const raValue = new Float32Array(nx * ny * nz)
  return {
    grid: { nx, ny, nz, vx, vy, vz, data, temperature, raValue, solidCount },
    dimensions: [L, W, H],
  }
}

// Carve sphere; returns number of voxels flipped to empty.
//
// Simultaneously applies per-voxel surface heating to:
//   (a) voxels inside the tool sphere (set to 1.0 before carving so that the
//       event is recorded even though those voxels will be removed — harmless
//       but kept for symmetry / debugging),
//   (b) voxels inside the expanded heat sphere (toolRadius * HEAT_RADIUS_OFFSET_FACTOR)
//       receive a Gaussian-falloff temperature based on distance to tool center,
//   (c) the 6-connected neighbors of every carved voxel are clamped to 1.0
//       so freshly-exposed surfaces always glow brightly right at the cut.
function carveSphere(
  grid: VoxelGrid,
  dimensions: [number, number, number],
  toolPos: [number, number, number],
  radius: number,
  raUm: number,
): number {
  if (radius <= 0) return 0
  const [L, W, H] = dimensions
  const { nx, ny, nz, vx, vy, vz, data, temperature, raValue } = grid

  // Stock is centered at origin on XZ (and Y), matching typical R3F stock convention:
  //   stock spans [-L/2, L/2] × [-W/2, W/2] × [-H/2, H/2]
  // Voxel (i,j,k) center = (-L/2 + (i+0.5)*vx, -W/2 + (j+0.5)*vy, -H/2 + (k+0.5)*vz)
  const originX = -L / 2
  const originY = -W / 2
  const originZ = -H / 2

  const [tx, ty, tz] = toolPos
  const r2 = radius * radius

  // Heat sphere radius: slightly larger than tool so that neighbors adjacent to
  // the contact surface get heated (even if they are never carved themselves).
  const heatRadius = radius * HEAT_RADIUS_OFFSET_FACTOR
  const hr2 = heatRadius * heatRadius
  // Gaussian falloff: temperature = exp(-k * (d/heatRadius)^2). k=3 gives a
  // ~5% tail at the heatRadius boundary, which is a nice soft glow.
  const falloffK = 3

  // Broad-phase bounding box in voxel indices. Use the LARGER of carve & heat
  // radii so the heat-only pass can fill in near-miss neighbors.
  const bradius = heatRadius
  const i0 = Math.max(0, Math.floor((tx - bradius - originX) / vx))
  const i1 = Math.min(nx - 1, Math.floor((tx + bradius - originX) / vx))
  const j0 = Math.max(0, Math.floor((ty - bradius - originY) / vy))
  const j1 = Math.min(ny - 1, Math.floor((ty + bradius - originY) / vy))
  const k0 = Math.max(0, Math.floor((tz - bradius - originZ) / vz))
  const k1 = Math.min(nz - 1, Math.floor((tz + bradius - originZ) / vz))
  if (i1 < i0 || j1 < j0 || k1 < k0) return 0

  let flipped = 0
  const nynz = ny * nz
  for (let i = i0; i <= i1; i++) {
    const cx = originX + (i + 0.5) * vx
    const ddx = cx - tx
    const ddx2 = ddx * ddx
    for (let j = j0; j <= j1; j++) {
      const cy = originY + (j + 0.5) * vy
      const ddy = cy - ty
      const ddy2 = ddy * ddy
      for (let k = k0; k <= k1; k++) {
        const cz = originZ + (k + 0.5) * vz
        const ddz = cz - tz
        const dist2 = ddx2 + ddy2 + ddz * ddz
        if (dist2 > hr2) continue
        const id = i * nynz + j * nz + k

        // Heat pass — every voxel within the heat sphere (solid or empty)
        // gets its temperature bumped up toward the falloff value. Using
        // max() means repeated passes over the same voxel don't cool it.
        if (data[id] === 1) {
          const norm = dist2 / hr2
          const t = Math.exp(-falloffK * norm)
          if (t > temperature[id]) temperature[id] = t
        }

        // Carve pass — only voxels strictly inside the tool sphere.
        if (dist2 <= r2 && data[id] === 1) {
          data[id] = 0
          flipped++

          // Heat the 6-connected neighbors of the carved voxel to 1.0 — these
          // are the freshly-exposed surfaces at the cut boundary. Simultaneously
          // stamp the theoretical Ra (µm) onto those same neighbors so the
          // roughness overlay picks them up on the next rebuild.
          if (i > 0) {
            const nid = id - nynz
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
          if (i < nx - 1) {
            const nid = id + nynz
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
          if (j > 0) {
            const nid = id - nz
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
          if (j < ny - 1) {
            const nid = id + nz
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
          if (k > 0) {
            const nid = id - 1
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
          if (k < nz - 1) {
            const nid = id + 1
            if (data[nid] === 1) {
              temperature[nid] = 1
              raValue[nid] = raUm
            }
          }
        }
      }
    }
  }
  if (flipped > 0) {
    grid.solidCount -= flipped
  }
  return flipped
}

// Decay every voxel's temperature toward 0 linearly with `dt * COOL_RATE`.
// Tight loop, no per-voxel closures. Returns the maximum temperature found
// after decay so the caller can drive material-level emissive intensity.
function decayTemperature(temperature: Float32Array, dt: number): number {
  const d = dt * COOL_RATE
  let maxT = 0
  const n = temperature.length
  for (let i = 0; i < n; i++) {
    const v = temperature[i] - d
    if (v > 0) {
      temperature[i] = v
      if (v > maxT) maxT = v
    } else {
      temperature[i] = 0
    }
  }
  return maxT
}

// Sample the heat gradient at t ∈ [0, 1]. `baseRGB` is used as the t=0 anchor.
// Writes result into out[outOff..outOff+2].
function sampleHeatGradient(
  t: number,
  baseRGB: [number, number, number],
  out: Float32Array,
  outOff: number,
): void {
  if (t <= 0) {
    out[outOff] = baseRGB[0]
    out[outOff + 1] = baseRGB[1]
    out[outOff + 2] = baseRGB[2]
    return
  }
  if (t >= 1) {
    const c = HEAT_STOP_RGB[3]
    out[outOff] = c[0]
    out[outOff + 1] = c[1]
    out[outOff + 2] = c[2]
    return
  }
  // Find the gradient segment.
  let seg = 0
  for (let i = 0; i < HEAT_STOP_T.length - 1; i++) {
    if (t >= HEAT_STOP_T[i] && t <= HEAT_STOP_T[i + 1]) {
      seg = i
      break
    }
  }
  const t0 = HEAT_STOP_T[seg]
  const t1 = HEAT_STOP_T[seg + 1]
  const a = seg === 0 ? baseRGB : HEAT_STOP_RGB[seg]
  const b = HEAT_STOP_RGB[seg + 1]
  const u = (t - t0) / (t1 - t0)
  const inv = 1 - u
  out[outOff] = a[0] * inv + b[0] * u
  out[outOff + 1] = a[1] * inv + b[1] * u
  out[outOff + 2] = a[2] * inv + b[2] * u
}

// Sample the Ra gradient at `raUm` (micrometers). Writes result into
// out[outOff..outOff+2]. See RA_STOP_UM / RA_STOP_RGB for the ramp definition.
//
// A raUm of 0 means "no cut happened here yet" (e.g. virgin exterior face of
// the stock); we return the base material color in that case so the overlay
// cleanly highlights only the machined surfaces.
function sampleRaGradient(
  raUm: number,
  baseRGB: [number, number, number],
  out: Float32Array,
  outOff: number,
): void {
  if (raUm <= 0) {
    out[outOff] = baseRGB[0]
    out[outOff + 1] = baseRGB[1]
    out[outOff + 2] = baseRGB[2]
    return
  }
  // Below the first stop → green.
  if (raUm <= RA_STOP_UM[0]) {
    const c = RA_STOP_RGB[0]
    out[outOff] = c[0]
    out[outOff + 1] = c[1]
    out[outOff + 2] = c[2]
    return
  }
  // Above the last stop → red.
  const lastIdx = RA_STOP_UM.length - 1
  if (raUm >= RA_STOP_UM[lastIdx]) {
    const c = RA_STOP_RGB[RA_STOP_RGB.length - 1]
    out[outOff] = c[0]
    out[outOff + 1] = c[1]
    out[outOff + 2] = c[2]
    return
  }
  // Find the segment. RA_STOP_UM has N stops and RA_STOP_RGB has N+1 colors,
  // where colors[i] anchors the left side of segment i and colors[i+1] the
  // right. Segment i covers RA_STOP_UM[i-1]..RA_STOP_UM[i] (with -∞ for i=0).
  for (let seg = 0; seg < RA_STOP_UM.length - 1; seg++) {
    const lo = RA_STOP_UM[seg]
    const hi = RA_STOP_UM[seg + 1]
    if (raUm >= lo && raUm <= hi) {
      const a = RA_STOP_RGB[seg]
      const b = RA_STOP_RGB[seg + 1]
      const u = (raUm - lo) / (hi - lo)
      const inv = 1 - u
      out[outOff] = a[0] * inv + b[0] * u
      out[outOff + 1] = a[1] * inv + b[1] * u
      out[outOff + 2] = a[2] * inv + b[2] * u
      return
    }
  }
  // Should be unreachable given the clamps above.
  const c = RA_STOP_RGB[RA_STOP_RGB.length - 1]
  out[outOff] = c[0]
  out[outOff + 1] = c[1]
  out[outOff + 2] = c[2]
}

// Build exposed-face geometry. Allocates tight typed arrays.
//
// When `thermalIntensity` > 0, per-vertex colors are emitted using the heat
// gradient (interpolated between the material's base color and the white-hot
// stops) and a per-vertex "heat" attribute is written (used for emissive
// boosting if the caller wants a custom shader). For `thermalIntensity === 0`
// the color attribute is still emitted as the flat base color (cheap, keeps
// material.vertexColors=true valid in all paths) and `heat` is all zeros.
function buildGeometry(
  grid: VoxelGrid,
  dimensions: [number, number, number],
  baseRGB: [number, number, number],
  thermalIntensity: number,
  showRaOverlay: boolean,
): THREE.BufferGeometry {
  const [L, W, H] = dimensions
  const { nx, ny, nz, vx, vy, vz, data, temperature, raValue } = grid
  const originX = -L / 2
  const originY = -W / 2
  const originZ = -H / 2

  // First pass: count exposed faces to allocate exactly.
  let faceCount = 0
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        if (data[idxOf(i, j, k, ny, nz)] !== 1) continue
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = FACES[f].dir
          const ni = i + dx
          const nj = j + dy
          const nk = k + dz
          const neighborSolid =
            ni >= 0 &&
            ni < nx &&
            nj >= 0 &&
            nj < ny &&
            nk >= 0 &&
            nk < nz &&
            data[idxOf(ni, nj, nk, ny, nz)] === 1
          if (!neighborSolid) faceCount++
        }
      }
    }
  }

  const positions = new Float32Array(faceCount * 4 * 3)
  const normals = new Float32Array(faceCount * 4 * 3)
  const colors = new Float32Array(faceCount * 4 * 3)
  const heats = new Float32Array(faceCount * 4)
  const indices = new Uint32Array(faceCount * 6)

  const clampedIntensity = Math.max(0, Math.min(1, thermalIntensity))

  let pPtr = 0
  let nPtr = 0
  let cPtr = 0
  let hPtr = 0
  let iPtr = 0
  let vertBase = 0

  for (let i = 0; i < nx; i++) {
    const x0 = originX + i * vx
    for (let j = 0; j < ny; j++) {
      const y0 = originY + j * vy
      for (let k = 0; k < nz; k++) {
        const srcId = idxOf(i, j, k, ny, nz)
        if (data[srcId] !== 1) continue
        const z0 = originZ + k * vz
        // Source voxel temperature, attenuated by thermalIntensity so the
        // gradient softly fades back to the base color as intensity goes to 0.
        const rawT = temperature[srcId]
        const effT = rawT * clampedIntensity
        // Source voxel Ra (µm) — 0 means "virgin / uncut", which the Ra
        // sampler renders as the base material color. Only consulted when
        // `showRaOverlay` is on.
        const raUm = raValue[srcId]

        for (let f = 0; f < 6; f++) {
          const face = FACES[f]
          const [dx, dy, dz] = face.dir
          const ni = i + dx
          const nj = j + dy
          const nk = k + dz
          const neighborSolid =
            ni >= 0 &&
            ni < nx &&
            nj >= 0 &&
            nj < ny &&
            nk >= 0 &&
            nk < nz &&
            data[idxOf(ni, nj, nk, ny, nz)] === 1
          if (neighborSolid) continue

          const [nxN, nyN, nzN] = face.normal
          for (let c = 0; c < 4; c++) {
            const [ox, oy, oz] = face.corners[c]
            positions[pPtr++] = x0 + ox * vx
            positions[pPtr++] = y0 + oy * vy
            positions[pPtr++] = z0 + oz * vz
            normals[nPtr++] = nxN
            normals[nPtr++] = nyN
            normals[nPtr++] = nzN
            if (showRaOverlay) {
              sampleRaGradient(raUm, baseRGB, colors, cPtr)
            } else {
              sampleHeatGradient(effT, baseRGB, colors, cPtr)
            }
            cPtr += 3
            heats[hPtr++] = effT
          }
          indices[iPtr++] = vertBase + 0
          indices[iPtr++] = vertBase + 1
          indices[iPtr++] = vertBase + 2
          indices[iPtr++] = vertBase + 0
          indices[iPtr++] = vertBase + 2
          indices[iPtr++] = vertBase + 3
          vertBase += 4
        }
      }
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geom.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  // Per-vertex heat attribute, available for custom shaders that want to
  // modulate emissive per-vertex. three's built-in MeshStandardMaterial does
  // not consume this by default; we approximate emissive on the material level
  // using the maximum stock temperature instead.
  geom.setAttribute("heat", new THREE.BufferAttribute(heats, 1))
  geom.setIndex(new THREE.BufferAttribute(indices, 1))
  geom.computeBoundingSphere()
  geom.computeBoundingBox()
  return geom
}

export function VoxelStock({
  dimensions,
  resolution = DEFAULT_RESOLUTION,
  toolPosition,
  toolRadius,
  material = "steel",
  onVolumeRemoved,
  thermalIntensity = 0,
  initialGeometry: seedGeometry,
  clippingPlanes,
  fz = 0.05,
  cornerRadius = 0.4,
  showRaOverlay = false,
  onGeometryUpdate,
}: VoxelStockProps): React.ReactElement {
  const meshRef = useRef<THREE.Mesh>(null)
  const gridRef = useRef<VoxelGrid | null>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)

  // Per-voxel volume in mm^3 (computed on grid init / dims change)
  const voxelVolumeRef = useRef(0)

  // Effective stock dimensions. When a seed geometry is voxelized these are
  // derived from its bounding box; otherwise they fall back to the `dimensions`
  // prop. A ref keeps carveSphere / buildGeometry in sync inside useFrame.
  const effectiveDimsRef = useRef<[number, number, number]>(dimensions)

  // Rebuild throttling state
  const flippedSinceBuildRef = useRef(0)
  const framesSinceBuildRef = useRef(0)
  const lastBuildAtRef = useRef(0)

  // Cumulative removed volume (mm^3), flushed out to callback as it grows.
  const removedVolumeRef = useRef(0)

  // Build initial grid + geometry when dims/resolution/seed change.
  const initialGeometry = useMemo(() => {
    let g: VoxelGrid
    let dims: [number, number, number] = dimensions
    if (seedGeometry) {
      const voxelized = voxelizeGeometry(seedGeometry, resolution)
      if (voxelized) {
        g = voxelized.grid
        dims = voxelized.dimensions
      } else {
        g = makeGrid(dimensions, resolution)
      }
    } else {
      g = makeGrid(dimensions, resolution)
    }
    gridRef.current = g
    effectiveDimsRef.current = dims
    voxelVolumeRef.current = g.vx * g.vy * g.vz
    flippedSinceBuildRef.current = 0
    framesSinceBuildRef.current = 0
    lastBuildAtRef.current = 0
    removedVolumeRef.current = 0
    // We use the MATERIAL_STYLES color directly here (rather than the closed-
    // over `style.color`) because this memo is intentionally NOT dependent on
    // material — a material switch only affects per-frame vertex colors on
    // next rebuild, not the initial grid allocation itself.
    const initStyle = MATERIAL_STYLES[material] ?? MATERIAL_STYLES.steel
    const initColor = new THREE.Color(initStyle.color)
    return buildGeometry(
      g,
      dims,
      [initColor.r, initColor.g, initColor.b],
      thermalIntensity,
      showRaOverlay,
    )
    // NOTE: we intentionally DO NOT include `material` / `thermalIntensity` /
    // `showRaOverlay` in the dep list — changes to any of these should NOT
    // blow away the current carving state. They are re-read on the next
    // throttled rebuild inside useFrame via the refs below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions, resolution, seedGeometry])

  // Keep a ref to currently assigned geometry so we can dispose on swap.
  const currentGeomRef = useRef<THREE.BufferGeometry>(initialGeometry)
  useEffect(() => {
    currentGeomRef.current = initialGeometry
    const mesh = meshRef.current
    if (mesh) {
      const old = mesh.geometry
      mesh.geometry = initialGeometry
      if (old && old !== initialGeometry) old.dispose()
    }
    return () => {
      // Cleanup on unmount / before next effect run.
      initialGeometry.dispose()
    }
  }, [initialGeometry])

  const style = MATERIAL_STYLES[material] ?? MATERIAL_STYLES.steel

  // Precompute base color as an [r,g,b] tuple in linear-ish 0..1 for the
  // vertex-color gradient interpolation. We parse via THREE.Color to accept any
  // CSS color string the style may use.
  const baseRGB = useMemo<[number, number, number]>(() => {
    const c = new THREE.Color(style.color)
    return [c.r, c.g, c.b]
  }, [style.color])

  // Ref tracks the latest thermalIntensity so the useFrame loop can read it
  // without needing to rebind each render.
  const thermalIntensityRef = useRef(thermalIntensity)
  thermalIntensityRef.current = thermalIntensity

  // Track the latest baseRGB in a ref for the mesh rebuild path.
  const baseRGBRef = useRef<[number, number, number]>(baseRGB)
  baseRGBRef.current = baseRGB

  // Ra-overlay-related refs (feed, nose radius, overlay toggle). All three
  // follow the same "refs-not-deps" pattern as thermalIntensity above — so
  // that changing any of them never blows away accumulated carve state.
  // We also precompute the Ra value in µm once per render (cheap) and stash
  // the ref so the per-frame carve loop doesn't redo the multiplication.
  const fzRef = useRef(fz)
  fzRef.current = fz
  const cornerRadiusRef = useRef(cornerRadius)
  cornerRadiusRef.current = cornerRadius
  const showRaOverlayRef = useRef(showRaOverlay)
  showRaOverlayRef.current = showRaOverlay
  // Ra [µm] = (fz² / (32·r_nose)) × 1000. Guard against r_nose ≤ 0.
  const raUm = useMemo(() => {
    const r = cornerRadius > 0 ? cornerRadius : 0.4
    return ((fz * fz) / (32 * r)) * 1000
  }, [fz, cornerRadius])
  const raUmRef = useRef(raUm)
  raUmRef.current = raUm

  // Mirror the external onGeometryUpdate callback through a ref so the
  // useFrame loop and the Ra-overlay effect don't need to bind to the current
  // function identity every render.
  const onGeometryUpdateRef = useRef<typeof onGeometryUpdate>(onGeometryUpdate)
  onGeometryUpdateRef.current = onGeometryUpdate

  useFrame((state, delta) => {
    const grid = gridRef.current
    const mesh = meshRef.current
    if (!grid || !mesh) return

    const flipped = carveSphere(
      grid,
      effectiveDimsRef.current,
      toolPosition,
      toolRadius,
      raUmRef.current,
    )
    if (flipped > 0) {
      flippedSinceBuildRef.current += flipped
      const addedMm3 = flipped * voxelVolumeRef.current
      removedVolumeRef.current += addedMm3
      onVolumeRemoved?.(removedVolumeRef.current)
    }
    framesSinceBuildRef.current += 1

    // Decay temperature every frame. Tight inlined loop, no closures per voxel.
    // The return value is the current maximum temperature across the stock,
    // which we use to drive material-level emissive intensity so that the
    // whole part softly glows when heavily heated (visible in dark scenes).
    const maxT = decayTemperature(grid.temperature, delta)
    const mat = materialRef.current
    const intensity = thermalIntensityRef.current
    if (mat) {
      if (intensity > 0 && maxT > 0) {
        // Scale emissive intensity by both the max-temp heat of the stock and
        // the externally-controlled thermalIntensity prop. Capped at 1.5 so
        // bloom post-processing doesn't blow out at peak temps.
        mat.emissiveIntensity = Math.min(1.5, maxT * intensity * 1.5)
      } else {
        mat.emissiveIntensity = 0
      }
    }

    const now = state.clock.elapsedTime
    const timeSinceBuild = now - lastBuildAtRef.current
    // Rebuild when we've carved enough voxels OR waited long enough. We also
    // force a rebuild whenever there's still measurable temperature on the
    // surface, so the vertex-color gradient keeps re-sampling the cooling
    // temperatures (otherwise the stock would show stale heat colors between
    // carves). Throttled by REBUILD_MIN_DT to keep the rebuild rate bounded.
    const hasHeat = intensity > 0 && maxT > 1e-3
    const shouldRebuild =
      timeSinceBuild >= REBUILD_MIN_DT &&
      (flippedSinceBuildRef.current >= REBUILD_VOXEL_THRESHOLD ||
        (flippedSinceBuildRef.current > 0 &&
          framesSinceBuildRef.current >= REBUILD_FRAME_THRESHOLD) ||
        (hasHeat && framesSinceBuildRef.current >= REBUILD_FRAME_THRESHOLD))

    if (shouldRebuild) {
      const next = buildGeometry(
        grid,
        effectiveDimsRef.current,
        baseRGBRef.current,
        intensity,
        showRaOverlayRef.current,
      )
      const old = mesh.geometry
      mesh.geometry = next
      currentGeomRef.current = next
      if (old && old !== next) old.dispose()
      flippedSinceBuildRef.current = 0
      framesSinceBuildRef.current = 0
      lastBuildAtRef.current = now
    }
  })

  // When the overlay toggle flips, we need to re-color the mesh right away
  // — otherwise the user would only see the switch take effect on the next
  // carve or heat-decay rebuild. We force a rebuild outside useFrame via a
  // tiny dedicated effect that skips the throttle.
  useEffect(() => {
    const grid = gridRef.current
    const mesh = meshRef.current
    if (!grid || !mesh) return
    const next = buildGeometry(
      grid,
      effectiveDimsRef.current,
      baseRGBRef.current,
      thermalIntensityRef.current,
      showRaOverlay,
    )
    const old = mesh.geometry
    mesh.geometry = next
    currentGeomRef.current = next
    if (old && old !== next) old.dispose()
    flippedSinceBuildRef.current = 0
    framesSinceBuildRef.current = 0
  }, [showRaOverlay])

  // Also dispose any live geometry on full unmount. Additionally drop the
  // grid reference so the parallel typed arrays (`data`, `temperature`,
  // `raValue`) are eligible for GC immediately — on resize/unmount they
  // shouldn't linger. The arrays themselves don't need explicit dispose()
  // (Float32Array / Uint8Array have no GPU resources), but clearing the
  // ref is the sibling to the three.js geometry dispose() above.
  useEffect(() => {
    return () => {
      const g = currentGeomRef.current
      if (g) g.dispose()
      gridRef.current = null
    }
  }, [])

  // Emissive color is picked to match the hottest gradient stop so that the
  // glow looks consistent with the vertex-color ramp. When thermalIntensity
  // is 0 we still set the emissive color but `emissiveIntensity` stays at 0
  // (driven from useFrame above), so the material looks identical to the
  // pre-thermal version.
  const emissiveColor = "#ffb347"

  // Auto-detect renderer-level clipping planes set by the parent scene so the
  // voxel stock can render DoubleSide at the cross-section without requiring
  // the caller to manually thread a per-material `clippingPlanes` array.
  const { gl } = useThree()
  const rendererHasClip = !!(gl && gl.clippingPlanes && gl.clippingPlanes.length > 0)
  const hasClip = !!(clippingPlanes && clippingPlanes.length > 0) || rendererHasClip
  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <meshStandardMaterial
        ref={materialRef}
        color={style.color}
        roughness={style.roughness}
        metalness={style.metalness}
        vertexColors
        emissive={emissiveColor}
        emissiveIntensity={0}
        toneMapped
        clippingPlanes={clippingPlanes ?? null}
        side={hasClip ? THREE.DoubleSide : THREE.FrontSide}
      />
    </mesh>
  )
}

export default VoxelStock
