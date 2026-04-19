import { NextRequest } from "next/server"
import { proxySse, MAX_DURATION } from "../../_lib/python-proxy"

export const maxDuration = MAX_DURATION
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  return proxySse(req, "/products/stream")
}
