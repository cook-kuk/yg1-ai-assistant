// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — 3D Mesh Export button
//
// Exposes the current voxel stock carved geometry as a downloadable STL (binary)
// or GLB (GLTF binary) file. Exporters are lazy-imported because they're
// heavy and the button is rarely clicked.
"use client"

import { useState } from "react"
import * as THREE from "three"

export interface MeshExportProps {
  /**
   * Callback that returns the current voxel stock geometry at click time.
   * Returns `null` when no geometry is available (e.g., voxel animation off).
   */
  getGeometry: () => THREE.BufferGeometry | null
  /** Base file name (no extension). Default "carved-stock". */
  meshName?: string
}

type ExportFormat = "stl" | "glb"

/**
 * Kick off a browser download via the Blob + object URL anchor pattern.
 * Used for both the binary STL (DataView) and GLB (ArrayBuffer) paths.
 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Release the object URL on the next tick so Safari has a chance to kick off
  // the download before we revoke it.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function MeshExport({
  getGeometry,
  meshName = "carved-stock",
}: MeshExportProps): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>("stl")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setError(null)
    const geometry = getGeometry()
    if (!geometry) {
      setError("내보낼 지오메트리가 없습니다 (voxel 애니메이션이 꺼져 있거나 아직 빌드되지 않음).")
      return
    }
    setBusy(true)
    try {
      // Build an ephemeral mesh/scene so the exporters have an Object3D to chew on.
      // We use a cheap basic material — exporters only consult transforms and
      // geometry; material choice only affects GLTF (kept to defaults).
      const material = new THREE.MeshStandardMaterial({ color: 0xcccccc })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = meshName

      if (format === "stl") {
        // Lazy-import STLExporter (heavy, rarely used).
        const { STLExporter } = await import(
          "three/examples/jsm/exporters/STLExporter.js"
        )
        const exporter = new STLExporter()
        // `binary: true` overload returns a DataView over an ArrayBuffer.
        const result = exporter.parse(mesh, { binary: true })
        const blob = new Blob([result], { type: "model/stl" })
        triggerDownload(blob, `${meshName}.stl`)
      } else {
        // Lazy-import GLTFExporter (heavy, rarely used).
        const { GLTFExporter } = await import(
          "three/examples/jsm/exporters/GLTFExporter.js"
        )
        const exporter = new GLTFExporter()
        await new Promise<void>((resolve, reject) => {
          exporter.parse(
            mesh,
            (gltf) => {
              try {
                if (gltf instanceof ArrayBuffer) {
                  const blob = new Blob([gltf], { type: "model/gltf-binary" })
                  triggerDownload(blob, `${meshName}.glb`)
                  resolve()
                } else {
                  reject(new Error("GLTFExporter: binary 옵션이 무시되었습니다."))
                }
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)))
              }
            },
            (err) => {
              reject(
                err instanceof Error
                  ? err
                  : new Error(
                      typeof err === "object" && err && "message" in err
                        ? String((err as { message?: unknown }).message)
                        : "GLTF 내보내기 실패",
                    ),
              )
            },
            { binary: true },
          )
        })
      }

      // Dispose the ephemeral material. The geometry belongs to the caller so
      // we leave it alone — disposing would nuke the live voxel mesh.
      material.dispose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`내보내기 실패: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <select
        value={format}
        onChange={(e) => setFormat(e.target.value as ExportFormat)}
        disabled={busy}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-mono text-slate-700 focus:outline-none disabled:opacity-50"
        aria-label="내보내기 형식"
      >
        <option value="stl">STL (binary)</option>
        <option value="glb">GLTF (.glb)</option>
      </select>
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="flex items-center gap-1 rounded-full border border-violet-300 bg-white px-3 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>💾 3D 내보내기{busy ? "..." : ""}</span>
      </button>
      {error && (
        <span className="text-[11px] text-rose-600" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default MeshExport
