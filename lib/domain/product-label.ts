/**
 * Product Label Builder — human-readable display labels for products.
 *
 * Generates labels like "4날 롱 스퀘어 엔드밀" from product data.
 */

import type { CanonicalProduct } from "@/lib/types/canonical"

const SUBTYPE_KO: Record<string, string> = {
  "Square": "스퀘어",
  "Ball": "볼",
  "Radius": "라디우스",
  "Corner Radius": "라디우스",
  "High-Feed": "하이피드",
  "Roughing": "황삭",
  "Taper": "테이퍼",
  "Chamfer": "챔퍼",
  "Drill": "드릴",
}

export function buildProductLabel(product: CanonicalProduct): string {
  // Priority 1: use productName if available
  if (product.productName) {
    return product.productName
  }

  // Priority 2: auto-compose from fields
  const parts: string[] = []

  // Flute count
  if (product.fluteCount != null) {
    parts.push(`${product.fluteCount}날`)
  }

  // Long/short判별
  if (product.lengthOfCutMm != null && product.diameterMm != null && product.diameterMm > 0) {
    const ratio = product.lengthOfCutMm / product.diameterMm
    if (ratio > 3) {
      parts.push("롱")
    }
  }

  // Tool subtype in Korean
  if (product.toolSubtype) {
    const ko = SUBTYPE_KO[product.toolSubtype]
    parts.push(ko ?? product.toolSubtype)
  }

  // Suffix
  parts.push("엔드밀")

  return parts.join(" ")
}
