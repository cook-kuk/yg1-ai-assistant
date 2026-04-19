import { NextRequest } from "next/server"
import { proxyJson, MAX_DURATION } from "../_lib/python-proxy"

export const maxDuration = MAX_DURATION

export async function POST(req: NextRequest) {
  return proxyJson(req, "/filter-options")
}
