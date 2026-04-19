import { NextRequest } from "next/server"
import { proxyJson } from "../_lib/python-proxy"

// Next 16 segment config must be a literal — cannot import. Keep in sync
// with the comment in app/api/_lib/python-proxy.ts.
export const maxDuration = 120

export async function POST(req: NextRequest) {
  return proxyJson(req, "/products")
}
