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
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"

// ─────────────────────────────────────────────
// SSOT constants
// ─────────────────────────────────────────────
const DEFAULT_RESOLUTION = 48
const REBUILD_VOXEL_THRESHOLD = 32
const REBUILD_FRAME_THRESHOLD = 4
const REBUILD_MAX_HZ = 30
const REBUILD_MIN_DT = 1 / REBUILD_MAX_HZ

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
}

// Hard upper bound on any geometry-derived voxelization (nx*ny*nz).
const MAX_VOXELIZE_CELLS = 64 * 64 * 64
// Reduced cap when no BVH accelerator is available.
const MAX_VOXELIZE_CELLS_NO_BVH = 48 * 48 * 48

// Runtime probe for `three-mesh-bvh`. We resolve lazily and cache the result so
// we avoid paying the dynamic-require cost per voxelization attempt, and so the
// component still builds when the dependency is absent from node_modules.
interface MeshBvhShim {
  // Patched methods attached to BufferGeometry.prototype and Raycaster.prototype.
  computeBoundsTree: unknown
  disposeBoundsTree: unknown
  acceleratedRaycast: unknown
}
let meshBvhProbe: MeshBvhShim | null | undefined
function tryLoadMeshBvh(): MeshBvhShim | null {
  if (meshBvhProbe !== undefined) return meshBvhProbe
  try {
    // Use a dynamic require so bundlers don't hard-fail when the dep is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const req: NodeRequire | undefined =
      typeof require === "function" ? (require as NodeRequire) : undefined
    if (!req) {
      meshBvhProbe = null
      return null
    }
    const mod = req("three-mesh-bvh") as MeshBvhShim
    if (
      mod &&
      typeof mod.computeBoundsTree !== "undefined" &&
      typeof mod.acceleratedRaycast !== "undefined"
    ) {
      meshBvhProbe = mod
      return mod
    }
    meshBvhProbe = null
    return null
  } catch {
    meshBvhProbe = null
    return null
  }
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
  return { nx, ny, nz, vx, vy, vz, data, solidCount: nx * ny * nz }
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
  const bvh = tryLoadMeshBvh()
  if (!bvh && nx * ny * nz > MAX_VOXELIZE_CELLS_NO_BVH) {
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
    !bvh && workGeom.index ? workGeom.toNonIndexed() : workGeom
  const mesh = new THREE.Mesh(prepared, new THREE.MeshBasicMaterial())

  const raycaster = new THREE.Raycaster()
  // Arbitrary +X axis ray; inside test is direction-agnostic.
  const rayDir = new THREE.Vector3(1, 0, 0)

  // Attach BVH if available. Use a structurally-typed view so the dynamic dep
  // does not leak into this file's static types.
  interface BvhCapableGeometry extends THREE.BufferGeometry {
    computeBoundsTree?: () => void
    disposeBoundsTree?: () => void
  }
  interface BvhCapableRaycaster extends THREE.Raycaster {
    firstHitOnly?: boolean
  }
  if (bvh) {
    const protoGeom = THREE.BufferGeometry.prototype as BvhCapableGeometry
    const protoRay = THREE.Raycaster.prototype as unknown as {
      raycast?: unknown
    }
    if (!protoGeom.computeBoundsTree) {
      ;(protoGeom as unknown as { computeBoundsTree: unknown }).computeBoundsTree =
        bvh.computeBoundsTree
      ;(protoGeom as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree =
        bvh.disposeBoundsTree
      protoRay.raycast = bvh.acceleratedRaycast
    }
    const pgeom = prepared as BvhCapableGeometry
    pgeom.computeBoundsTree?.()
    ;(raycaster as BvhCapableRaycaster).firstHitOnly = false
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
  if (bvh) {
    const pgeom = prepared as BvhCapableGeometry
    pgeom.disposeBoundsTree?.()
  }
  if (prepared !== workGeom) prepared.dispose()
  workGeom.dispose()
  ;(mesh.material as THREE.Material).dispose()

  return {
    grid: { nx, ny, nz, vx, vy, vz, data, solidCount },
    dimensions: [L, W, H],
  }
}

// Carve sphere; returns number of voxels flipped to empty.
function carveSphere(
  grid: VoxelGrid,
  dimensions: [number, number, number],
  toolPos: [number, number, number],
  radius: number,
): number {
  if (radius <= 0) return 0
  const [L, W, H] = dimensions
  const { nx, ny, nz, vx, vy, vz, data } = grid

  // Stock is centered at origin on XZ (and Y), matching typical R3F stock convention:
  //   stock spans [-L/2, L/2] × [-W/2, W/2] × [-H/2, H/2]
  // Voxel (i,j,k) center = (-L/2 + (i+0.5)*vx, -W/2 + (j+0.5)*vy, -H/2 + (k+0.5)*vz)
  const originX = -L / 2
  const originY = -W / 2
  const originZ = -H / 2

  const [tx, ty, tz] = toolPos
  const r2 = radius * radius

  // Broad-phase bounding box in voxel indices
  const i0 = Math.max(0, Math.floor((tx - radius - originX) / vx))
  const i1 = Math.min(nx - 1, Math.floor((tx + radius - originX) / vx))
  const j0 = Math.max(0, Math.floor((ty - radius - originY) / vy))
  const j1 = Math.min(ny - 1, Math.floor((ty + radius - originY) / vy))
  const k0 = Math.max(0, Math.floor((tz - radius - originZ) / vz))
  const k1 = Math.min(nz - 1, Math.floor((tz + radius - originZ) / vz))
  if (i1 < i0 || j1 < j0 || k1 < k0) return 0

  let flipped = 0
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
        if (dist2 <= r2) {
          const id = i * ny * nz + j * nz + k
          if (data[id] === 1) {
            data[id] = 0
            flipped++
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

// Build exposed-face geometry. Allocates tight typed arrays.
function buildGeometry(
  grid: VoxelGrid,
  dimensions: [number, number, number],
): THREE.BufferGeometry {
  const [L, W, H] = dimensions
  const { nx, ny, nz, vx, vy, vz, data } = grid
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
  const indices = new Uint32Array(faceCount * 6)

  let pPtr = 0
  let nPtr = 0
  let iPtr = 0
  let vertBase = 0

  for (let i = 0; i < nx; i++) {
    const x0 = originX + i * vx
    for (let j = 0; j < ny; j++) {
      const y0 = originY + j * vy
      for (let k = 0; k < nz; k++) {
        if (data[idxOf(i, j, k, ny, nz)] !== 1) continue
        const z0 = originZ + k * vz
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
  initialGeometry: seedGeometry,
}: VoxelStockProps): React.ReactElement {
  const meshRef = useRef<THREE.Mesh>(null)
  const gridRef = useRef<VoxelGrid | null>(null)

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
    return buildGeometry(g, dims)
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

  useFrame((state, delta) => {
    const grid = gridRef.current
    const mesh = meshRef.current
    if (!grid || !mesh) return

    const flipped = carveSphere(
      grid,
      effectiveDimsRef.current,
      toolPosition,
      toolRadius,
    )
    if (flipped > 0) {
      flippedSinceBuildRef.current += flipped
      const addedMm3 = flipped * voxelVolumeRef.current
      removedVolumeRef.current += addedMm3
      onVolumeRemoved?.(removedVolumeRef.current)
    }
    framesSinceBuildRef.current += 1

    const now = state.clock.elapsedTime
    const timeSinceBuild = now - lastBuildAtRef.current
    const shouldRebuild =
      flippedSinceBuildRef.current > 0 &&
      timeSinceBuild >= REBUILD_MIN_DT &&
      (flippedSinceBuildRef.current >= REBUILD_VOXEL_THRESHOLD ||
        framesSinceBuildRef.current >= REBUILD_FRAME_THRESHOLD)

    if (shouldRebuild) {
      const next = buildGeometry(grid, effectiveDimsRef.current)
      const old = mesh.geometry
      mesh.geometry = next
      currentGeomRef.current = next
      if (old && old !== next) old.dispose()
      flippedSinceBuildRef.current = 0
      framesSinceBuildRef.current = 0
      lastBuildAtRef.current = now
    }
  })

  // Also dispose any live geometry on full unmount.
  useEffect(() => {
    return () => {
      const g = currentGeomRef.current
      if (g) g.dispose()
    }
  }, [])

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <meshStandardMaterial
        color={style.color}
        roughness={style.roughness}
        metalness={style.metalness}
      />
    </mesh>
  )
}

export default VoxelStock
