"use client"

/**
 * DrawingImport
 * -------------
 * Standalone drawing -> THREE.BufferGeometry upload component for the v2
 * cutting simulator.
 *
 *  - .step / .stp / .iges / .igs  -> parsed with `occt-import-js`, all meshes
 *    merged into a single indexed `BufferGeometry` via `mergeGeometries`.
 *  - .dxf                         -> parsed with `dxf-parser`, 2D polylines
 *    (LWPOLYLINE / POLYLINE / LINE / CIRCLE) are extruded by
 *    `defaultThickness` (mm) using `ExtrudeGeometry`.
 *
 *  The component is intentionally self contained: it does NOT wire into the
 *  cutting simulator automatically. Integration is done by the parent via the
 *  `onGeometry` callback.
 */

import { useCallback, useId, useRef, useState } from "react"
import * as THREE from "three"
// Three.js ships these as side-modules - typings come from @types/three.
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
// `dxf-parser` has full typings shipped in its own package.
import DxfParser, {
  type IDxf,
  type IEntity,
  type ILineEntity,
  type ILwpolylineEntity,
  type IPolylineEntity,
  type ICircleEntity,
} from "dxf-parser"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type DrawingSource = "step" | "dxf"

export interface DrawingMetadata {
  source: DrawingSource
  name: string
  /** [sizeX, sizeY, sizeZ] of the axis-aligned bounding box, in mm. */
  bbox: [number, number, number]
}

export interface DrawingImportProps {
  onGeometry: (geometry: THREE.BufferGeometry, metadata: DrawingMetadata) => void
  /** Extrusion thickness for .dxf imports (mm). Default 10. */
  defaultThickness?: number
  /** Optional extra className for the root container. */
  className?: string
  /** Optional label override for the drop target. */
  label?: string
}

// -----------------------------------------------------------------------------
// occt-import-js shim
// -----------------------------------------------------------------------------
// The npm package does NOT ship TypeScript typings, and the default export is
// an Emscripten factory function. We import it dynamically so that the wasm
// asset is only fetched when a STEP/IGES file is actually uploaded (and to
// avoid SSR issues in Next.js).

interface OcctMesh {
  name?: string
  color?: [number, number, number]
  attributes: {
    position: { array: number[] | Float32Array }
    normal?: { array: number[] | Float32Array }
  }
  index: { array: number[] | Uint32Array }
}

interface OcctResult {
  success: boolean
  root?: unknown
  meshes: OcctMesh[]
}

interface OcctApi {
  ReadStepFile: (content: Uint8Array, params: unknown) => OcctResult
  ReadIgesFile: (content: Uint8Array, params: unknown) => OcctResult
  ReadBrepFile: (content: Uint8Array, params: unknown) => OcctResult
}

type OcctFactory = () => Promise<OcctApi>

let occtPromise: Promise<OcctApi> | null = null

async function loadOcct(): Promise<OcctApi> {
  if (!occtPromise) {
    occtPromise = (async () => {
      // Dynamic import - the module resolves to a factory function.
      // `occt-import-js` ships no TypeScript typings, hence the ts-ignore.
      // @ts-ignore - no bundled types; API is narrowed via the `OcctApi` interface above.
      const mod: unknown = await import("occt-import-js")
      const factory = ((mod as { default?: OcctFactory }).default ??
        (mod as OcctFactory)) as OcctFactory
      if (typeof factory !== "function") {
        throw new Error("occt-import-js did not expose a callable factory")
      }
      return await factory()
    })()
  }
  return occtPromise
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ""
}

function bboxFrom(geometry: THREE.BufferGeometry): [number, number, number] {
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (!bb) return [0, 0, 0]
  return [
    Math.max(0, bb.max.x - bb.min.x),
    Math.max(0, bb.max.y - bb.min.y),
    Math.max(0, bb.max.z - bb.min.z),
  ]
}

// --- STEP / IGES ------------------------------------------------------------

function occtMeshToGeometry(mesh: OcctMesh): THREE.BufferGeometry | null {
  const posArr = mesh.attributes?.position?.array
  const idxArr = mesh.index?.array
  if (!posArr || posArr.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  const positions = posArr instanceof Float32Array ? posArr : new Float32Array(posArr)
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))

  const normalArr = mesh.attributes?.normal?.array
  if (normalArr && normalArr.length === positions.length) {
    const normals =
      normalArr instanceof Float32Array ? normalArr : new Float32Array(normalArr)
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
  }

  if (idxArr && idxArr.length > 0) {
    const indices = idxArr instanceof Uint32Array ? idxArr : new Uint32Array(idxArr)
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  }

  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals()
  }
  return geometry
}

async function parseStepOrIges(
  file: File,
  kind: "step" | "iges",
): Promise<THREE.BufferGeometry> {
  const occt = await loadOcct()
  const buffer = new Uint8Array(await file.arrayBuffer())
  const result =
    kind === "step" ? occt.ReadStepFile(buffer, null) : occt.ReadIgesFile(buffer, null)
  if (!result || !result.success) {
    throw new Error(`occt-import-js failed to parse ${kind.toUpperCase()} file`)
  }
  const meshes = result.meshes ?? []
  if (meshes.length === 0) {
    throw new Error(`${kind.toUpperCase()} file contained no meshes`)
  }

  const parts: THREE.BufferGeometry[] = []
  for (const m of meshes) {
    const g = occtMeshToGeometry(m)
    if (g) parts.push(g)
  }
  if (parts.length === 0) {
    throw new Error(`${kind.toUpperCase()} produced no renderable geometry`)
  }

  // mergeGeometries requires matching attribute sets; we always provide
  // position + normal, no index normalization needed since all parts share the
  // same layout after `occtMeshToGeometry`.
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  if (!merged) {
    throw new Error("Failed to merge STEP/IGES meshes")
  }
  return merged
}

// --- DXF --------------------------------------------------------------------

type Vec2 = { x: number; y: number }

function entityToShape(entity: IEntity): THREE.Shape | null {
  const type = entity.type
  if (type === "LWPOLYLINE" || type === "POLYLINE") {
    const verts = (entity as ILwpolylineEntity | IPolylineEntity).vertices
    if (!verts || verts.length < 2) return null
    const pts: Vec2[] = verts.map((v) => ({ x: v.x ?? 0, y: v.y ?? 0 }))
    return shapeFromPoints(pts)
  }
  if (type === "LINE") {
    const line = entity as ILineEntity
    const v = line.vertices
    if (!v || v.length < 2) return null
    return shapeFromPoints(v.map((p) => ({ x: p.x ?? 0, y: p.y ?? 0 })))
  }
  if (type === "CIRCLE") {
    const c = entity as ICircleEntity
    const center = c.center ?? { x: 0, y: 0, z: 0 }
    const r = c.radius ?? 0
    if (r <= 0) return null
    const shape = new THREE.Shape()
    shape.absarc(center.x ?? 0, center.y ?? 0, r, 0, Math.PI * 2, false)
    return shape
  }
  return null
}

function shapeFromPoints(pts: Vec2[]): THREE.Shape | null {
  if (pts.length < 2) return null
  const shape = new THREE.Shape()
  shape.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i].x, pts[i].y)
  }
  return shape
}

async function parseDxf(file: File, thickness: number): Promise<THREE.BufferGeometry> {
  const text = await file.text()
  const parser = new DxfParser()
  let dxf: IDxf | null
  try {
    dxf = parser.parseSync(text)
  } catch (err) {
    throw new Error(
      `DXF parse error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!dxf || !dxf.entities || dxf.entities.length === 0) {
    throw new Error("DXF file contained no entities")
  }

  const shapes: THREE.Shape[] = []
  for (const entity of dxf.entities) {
    const s = entityToShape(entity)
    if (s) shapes.push(s)
  }
  if (shapes.length === 0) {
    throw new Error(
      "DXF had no supported 2D profile entities (LWPOLYLINE / POLYLINE / LINE / CIRCLE)",
    )
  }

  const depth = thickness > 0 ? thickness : 10
  const geom = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 24,
    steps: 1,
  })
  geom.computeVertexNormals()
  return geom
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

const ACCEPT = ".step,.stp,.iges,.igs,.dxf"

export function DrawingImport({
  onGeometry,
  defaultThickness = 10,
  className,
  label = "Upload STEP / IGES / DXF",
}: DrawingImportProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFileName, setLastFileName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(true)
      setLastFileName(file.name)
      try {
        const ext = extOf(file.name)
        let geometry: THREE.BufferGeometry
        let source: DrawingSource
        if (ext === "step" || ext === "stp") {
          geometry = await parseStepOrIges(file, "step")
          source = "step"
        } else if (ext === "iges" || ext === "igs") {
          geometry = await parseStepOrIges(file, "iges")
          source = "step" // metadata.source is the coarse bucket per contract
        } else if (ext === "dxf") {
          geometry = await parseDxf(file, defaultThickness)
          source = "dxf"
        } else {
          throw new Error(
            `Unsupported file type ".${ext}". Use .step / .stp / .iges / .igs / .dxf`,
          )
        }

        const bbox = bboxFrom(geometry)
        onGeometry(geometry, { source, name: file.name, bbox })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [defaultThickness, onGeometry],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (f) void handleFile(f)
      // reset so the same file can be re-uploaded
      e.target.value = ""
    },
    [handleFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (f) void handleFile(f)
    },
    [handleFile],
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  // Mobile-first: compact h-24, expand to h-40 on sm+. Use Tailwind so we can
  // tweak via responsive utilities; keep the dynamic drag-over color inline.
  const rootStyle: React.CSSProperties = {
    border: `2px dashed ${dragOver ? "#4f8ef7" : "#9aa3ad"}`,
    background: dragOver ? "rgba(79,142,247,0.08)" : "transparent",
    color: "inherit",
    fontFamily: "inherit",
    cursor: busy ? "progress" : "pointer",
    transition: "background 120ms ease, border-color 120ms ease",
  }

  const rootClass = [
    "flex flex-col items-center justify-center gap-2 rounded-lg text-center",
    "h-24 p-3 text-xs sm:h-40 sm:p-4 sm:text-sm",
    className ?? "",
  ].filter(Boolean).join(" ")

  return (
    <div
      className={rootClass}
      style={rootStyle}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => {
        if (!busy) inputRef.current?.click()
      }}
      role="button"
      aria-busy={busy}
      aria-label={label}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onInputChange}
        style={{ display: "none" }}
        disabled={busy}
      />
      <div className="font-semibold">
        {busy ? "Parsing drawing..." : label}
      </div>
      <div className="text-[11px] opacity-75 hidden sm:block">
        Drop a .step, .stp, .iges, .igs, or .dxf file here, or click to browse.
        DXF files are extruded by {defaultThickness}&nbsp;mm.
      </div>
      <div className="text-[10px] opacity-75 sm:hidden">
        .step / .stp / .iges / .igs / .dxf
      </div>
      {lastFileName && !error && !busy && (
        <div className="text-[11px] opacity-75 truncate max-w-full">Loaded: {lastFileName}</div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 4,
            padding: "6px 8px",
            borderRadius: 4,
            background: "rgba(220,38,38,0.12)",
            color: "#b91c1c",
            fontSize: 12,
            textAlign: "left",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

export default DrawingImport
